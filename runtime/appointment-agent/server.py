from __future__ import annotations

import asyncio
import base64
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional
from urllib import error, request

import numpy as np
import soxr
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect, WebSocketState
from websockets import connect
from websockets.exceptions import ConnectionClosedOK

load_dotenv()

HOST = os.getenv("APPOINTMENT_AGENT_RUNTIME_HOST", "127.0.0.1")
PORT = int(os.getenv("APPOINTMENT_AGENT_RUNTIME_PORT", "3011"))
RUNTIME_TOKEN = os.getenv("APPOINTMENT_AGENT_RUNTIME_TOKEN", "demo-appointment-runtime-secret")
CONTROL_PLANE_BASE_URL = os.getenv("CONTROL_PLANE_BASE_URL", "http://127.0.0.1:3001")
CONTROL_PLANE_RUNTIME_TOKEN = os.getenv("CONTROL_PLANE_RUNTIME_TOKEN", "demo-runtime-secret")
OPENAI_URL = os.getenv("OPENAI_URL", "wss://api.openai.com/v1/realtime?model=gpt-realtime")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_TEXT_MODEL = os.getenv("APPOINTMENT_AGENT_TEXT_MODEL", "gpt-4o-mini")
FRAME_LEN_MS = 20

app = FastAPI(title="Appointment Agent Runtime")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def post_json(url: str, payload: dict, token: Optional[str] = None) -> dict:
    def send_request() -> dict:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {token}"} if token else {}),
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=20) as response:
                return json.loads(response.read().decode("utf-8") or "{}")
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8") or "{}"
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"error": raw}
            raise RuntimeError(payload.get("error") or f"HTTP {exc.code}")

    return await asyncio.to_thread(send_request)


def normalize_text(value: str) -> str:
    return str(value or "").strip().lower()


def require_runtime_auth(authorization: Optional[str]) -> None:
    if authorization != f"Bearer {RUNTIME_TOKEN}":
        raise HTTPException(status_code=401, detail="Runtime authentication required.")


def format_workers(snapshot: dict) -> str:
    return "\n".join(
        f"{worker['name']} · {worker['roleLabel']} · {worker['specialty']} · {worker['locationLabel']} · {worker['availabilitySummary']}"
        for worker in snapshot["workers"]
    )


def format_clients(snapshot: dict) -> str:
    return "\n".join(
        f"{client['fullName']} · {client['phone']} · {client['notes']}"
        for client in snapshot["clients"]
    )


def format_appointments(snapshot: dict) -> str:
    if not snapshot["appointments"]:
        return "There are no scheduled appointments yet."
    return "\n".join(
        f"{appointment['id']} · {appointment['clientName']} with {appointment['workerName']} · {appointment['startAt']} · {appointment['status']}"
        for appointment in snapshot["appointments"]
    )


def format_slots(snapshot: dict) -> str:
    if not snapshot["availableSlots"]:
        return "No open slots are available right now."
    return "\n".join(
        f"{slot['id']} · {slot['label']}" for slot in snapshot["availableSlots"]
    )


def resolve_client(snapshot: dict, normalized_message: str) -> Optional[dict]:
    return next(
        (
            client
            for client in snapshot["clients"]
            if client["fullName"].lower() in normalized_message
        ),
        None,
    )


def resolve_slot(snapshot: dict, normalized_message: str) -> Optional[dict]:
    return next(
        (
            slot
            for slot in snapshot["availableSlots"]
            if slot["id"].lower() in normalized_message
        ),
        None,
    )


def resolve_appointment(snapshot: dict, normalized_message: str) -> Optional[dict]:
    return next(
        (
            appointment
            for appointment in snapshot["appointments"]
            if appointment["id"].lower() in normalized_message
        ),
        None,
    )


def run_text_demo(snapshot: dict, message: str) -> dict:
    normalized_message = normalize_text(message)

    if "workers" in normalized_message:
        return {"reply": format_workers(snapshot), "operation": None}
    if "appointments" in normalized_message:
        return {"reply": format_appointments(snapshot), "operation": None}
    if "slots" in normalized_message or "availability" in normalized_message:
        return {"reply": format_slots(snapshot), "operation": None}
    if "summary" in normalized_message:
        return {
            "reply": f"{len(snapshot['workers'])} workers, {len(snapshot['clients'])} clients, {len(snapshot['appointments'])} appointments, {len(snapshot['availableSlots'])} open demo slots.",
            "operation": None,
        }
    if "book" in normalized_message:
        slot = resolve_slot(snapshot, normalized_message)
        if not slot:
            return {
                "reply": "To book, mention a slot id or ask for an available time. Example: book slot-worker-... .",
                "operation": None,
            }
        return {
            "reply": f"Booked you with {slot['workerName']} for {slot['label']}.",
            "operation": {
                "type": "book",
                "slotId": slot["id"],
            },
        }
    if "cancel" in normalized_message:
        appointment = resolve_appointment(snapshot, normalized_message)
        if not appointment:
            return {
                "reply": "To cancel, mention the appointment id. Example: cancel appt-....",
                "operation": None,
            }
        return {
            "reply": f"Cancelled {appointment['id']} for {appointment['clientName']} with {appointment['workerName']}.",
            "operation": {
                "type": "cancel",
                "appointmentId": appointment["id"],
            },
        }
    return {
        "reply": "I can help with workers, clients, appointments, available slots, booking, or cancelling. Try: show workers, show clients, show appointments, show slots, book slot-... for Amelia Stone, or cancel appt-....",
        "operation": None,
    }


async def call_openai_chat_completions(messages: list[dict], tools: list[dict]) -> dict:
    def send_request() -> dict:
        body = json.dumps(
            {
                "model": OPENAI_TEXT_MODEL,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto",
                "temperature": 0.2,
            }
        ).encode("utf-8")
        req = request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8") or "{}")
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8") or "{}"
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"error": raw}
            message = payload.get("error", {}).get("message") or payload.get("error") or f"HTTP {exc.code}"
            raise RuntimeError(str(message))

    return await asyncio.to_thread(send_request)


async def run_ai_text_demo(snapshot: dict, message: str) -> dict:
    if not OPENAI_API_KEY:
        return run_text_demo(snapshot, message)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "list_workers",
                "description": "List the available workers/providers.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_appointments",
                "description": "List scheduled appointments.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_available_slots",
                "description": "List open 1-hour appointment slots with worker names and exact times.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "book_appointment",
                "description": "Book the signed-in user into a specific open slot id once the correct worker/date/time has been resolved.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "slot_id": {"type": "string"},
                    },
                    "required": ["slot_id"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "cancel_appointment",
                "description": "Cancel an existing appointment by appointment id.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "appointment_id": {"type": "string"},
                    },
                    "required": ["appointment_id"],
                    "additionalProperties": False,
                },
            },
        },
    ]

    messages = [
        {
            "role": "system",
            "content": (
                "You are an appointment booking agent. Use tools to resolve natural language requests into concrete scheduling actions.\n"
                "Do not ask for slot ids unless the request is ambiguous and you truly cannot resolve it.\n"
                "Infer the worker from partial names like 'Warren' and infer the requested date/time from the user's wording.\n"
                "If an exact matching slot exists, call book_appointment or cancel_appointment directly.\n"
                "If no exact match exists, explain what is unavailable and offer the nearest alternatives based on listed slots."
            ),
        },
        {
            "role": "system",
            "content": (
                f"Current workers: {', '.join(worker['name'] for worker in snapshot['workers'])}. "
                f"There are {len(snapshot['appointments'])} appointments and {len(snapshot['availableSlots'])} open slots in the schedule."
            ),
        },
        {"role": "user", "content": message},
    ]

    pending_operation: Optional[dict] = None

    for _ in range(6):
        completion = await call_openai_chat_completions(messages, tools)
        choice = (completion.get("choices") or [{}])[0]
        response_message = choice.get("message") or {}
        tool_calls = response_message.get("tool_calls") or []
        content = response_message.get("content") or ""

        if tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": tool_calls,
                }
            )
            for tool_call in tool_calls:
                function_call = tool_call.get("function") or {}
                tool_name = function_call.get("name") or ""
                try:
                    arguments = json.loads(function_call.get("arguments") or "{}")
                except json.JSONDecodeError:
                    arguments = {}

                if tool_name == "list_workers":
                    result = {"workers": snapshot["workers"]}
                elif tool_name == "list_appointments":
                    result = {"appointments": snapshot["appointments"]}
                elif tool_name == "list_available_slots":
                    result = {"availableSlots": snapshot["availableSlots"]}
                elif tool_name == "book_appointment":
                    slot_id = arguments.get("slot_id")
                    slot = next((entry for entry in snapshot["availableSlots"] if entry["id"] == slot_id), None)
                    if slot:
                        pending_operation = {"type": "book", "slotId": slot_id}
                        result = {"ok": True, "summary": f"Prepared booking for {slot['label']}."}
                    else:
                        result = {"ok": False, "error": "Requested slot id was not available."}
                elif tool_name == "cancel_appointment":
                    appointment_id = arguments.get("appointment_id")
                    appointment = next(
                        (entry for entry in snapshot["appointments"] if entry["id"] == appointment_id),
                        None,
                    )
                    if appointment:
                        pending_operation = {"type": "cancel", "appointmentId": appointment_id}
                        result = {"ok": True, "summary": f"Prepared cancellation for {appointment_id}."}
                    else:
                        result = {"ok": False, "error": "Requested appointment id was not found."}
                else:
                    result = {"ok": False, "error": f"Unsupported tool {tool_name}"}

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.get("id"),
                        "content": json.dumps(result),
                    }
                )
            continue

        if content:
            return {"reply": content, "operation": pending_operation}

    return run_text_demo(snapshot, message)


class Termination:
    pass


class ClearBuffer:
    pass


@dataclass()
class STTResult:
    text: str


@dataclass()
class ControlEvent:
    payload: dict


@dataclass()
class PipelineParams:
    ws: WebSocket
    session_config: dict
    sample_rate: int


class InputTransport:
    def __init__(self, ws: WebSocket):
        self._ws = ws

    async def connect(self) -> None:
        return None

    async def run(self) -> None:
        try:
            while True:
                message = await self._ws.receive()
                message_type = message.get("type")
                if message_type == "websocket.disconnect":
                    break

                text_payload = message.get("text")
                if text_payload is not None:
                    try:
                        event = json.loads(text_payload)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") in ("gateway.user_text", "user_text"):
                        text = str(event.get("text") or "").strip()
                        if text:
                            await self.next.send(STTResult(text=text))
                    continue

                raw = message.get("bytes")
                if raw is not None and len(raw) > 1 and raw[0] == 1:
                    await self.next.send(raw[1:])
        except WebSocketDisconnect:
            pass

        await self.next.send(Termination())


class OutputTransport:
    def __init__(self, ws: WebSocket, sample_rate: int, control_handler):
        self._ws = ws
        self._sample_rate = sample_rate
        self._control_handler = control_handler
        self._send_seqn = 0
        self._running = True
        self._send_buffer: list[bytes] = []

    async def connect(self) -> None:
        return None

    async def run(self) -> None:
        start_tm = asyncio.get_running_loop().time()
        try:
            while self._running:
                chunk_size = int(2 * FRAME_LEN_MS * self._sample_rate / 1000)
                data = self._read(chunk_size)
                self._send_seqn += 1
                wait_tm = start_tm + FRAME_LEN_MS / 1000 * self._send_seqn - asyncio.get_running_loop().time()
                if wait_tm > 0:
                    await asyncio.sleep(wait_tm)
                if self._ws.client_state != WebSocketState.CONNECTED:
                    break
                await self._ws.send_bytes(b"\x01" + data)
        except Exception:
            return None

    def _read(self, size: int) -> bytes:
        if not self._send_buffer:
            return b"\x00" * size

        parts = []
        remaining = size
        while remaining > 0 and self._send_buffer:
            chunk = self._send_buffer[0]
            if len(chunk) <= remaining:
                parts.append(chunk)
                self._send_buffer.pop(0)
                remaining -= len(chunk)
            else:
                parts.append(chunk[:remaining])
                self._send_buffer[0] = chunk[remaining:]
                remaining = 0
        if remaining > 0:
            parts.append(b"\x00" * remaining)
        return b"".join(parts)

    async def send(self, data: Any) -> None:
        if isinstance(data, Termination):
            self._running = False
            return
        if isinstance(data, ClearBuffer):
            self._send_buffer = []
            return
        if isinstance(data, ControlEvent):
            self._control_handler(data.payload)
            if self._ws.client_state == WebSocketState.CONNECTED:
                await self._ws.send_json(data.payload)
            return
        if isinstance(data, bytes):
            self._send_buffer.append(data)


class AppointmentToolExecutor:
    def __init__(self, call_session_id: str):
        self._call_session_id = call_session_id
        self._context: Optional[dict] = None

    async def load(self) -> dict:
        self._context = await post_json(
            f"{CONTROL_PLANE_BASE_URL}/api/internal/appointment-agent/context",
            {"callSessionId": self._call_session_id},
            CONTROL_PLANE_RUNTIME_TOKEN,
        )
        return self._context

    @property
    def context(self) -> dict:
        if self._context is None:
            raise RuntimeError("Appointment context not loaded.")
        return self._context

    async def refresh(self) -> dict:
        return await self.load()

    async def execute(self, tool_name: str, arguments: dict) -> dict:
        if tool_name == "list_workers":
            return {"workers": self.context["snapshot"]["workers"]}
        if tool_name == "list_appointments":
            return {"appointments": self.context["snapshot"]["appointments"]}
        if tool_name == "list_available_slots":
            return {"availableSlots": self.context["snapshot"]["availableSlots"]}
        if tool_name == "book_appointment":
            result = await post_json(
                f"{CONTROL_PLANE_BASE_URL}/api/internal/appointment-agent/book",
                {
                    "callSessionId": self._call_session_id,
                    "slotId": arguments.get("slot_id"),
                },
                CONTROL_PLANE_RUNTIME_TOKEN,
            )
            await self.refresh()
            return result
        if tool_name == "cancel_appointment":
            result = await post_json(
                f"{CONTROL_PLANE_BASE_URL}/api/internal/appointment-agent/cancel",
                {
                    "callSessionId": self._call_session_id,
                    "appointmentId": arguments.get("appointment_id"),
                },
                CONTROL_PLANE_RUNTIME_TOKEN,
            )
            await self.refresh()
            return result
        return {"error": f"Unsupported tool {tool_name}"}


class OpenAIRealtime:
    def __init__(self, session_config: dict, sample_rate: int, control_handler, tool_executor):
        self._session_config = session_config
        self._sample_rate = sample_rate
        self._control_handler = control_handler
        self._tool_executor = tool_executor
        self._transcription_model = session_config["agent"].get("sttType") or "gpt-4o-mini-transcribe"
        self._transcription_prompt = session_config["agent"].get("sttPrompt") or ""
        self._voice = session_config["agent"].get("ttsVoice") or "alloy"
        self._instructions = self._build_instructions()
        if sample_rate != 24000:
            self._soxr_out = soxr.ResampleStream(
                in_rate=24000,
                out_rate=sample_rate,
                num_channels=1,
                quality="VHQ",
                dtype="int16",
            )
            self._soxr_in = soxr.ResampleStream(
                in_rate=sample_rate,
                out_rate=24000,
                num_channels=1,
                quality="HQ",
                dtype="int16",
            )
        else:
            self._soxr_out = None
            self._soxr_in = None

    def _build_instructions(self) -> str:
        snapshot = self._session_config["snapshot"]
        workers = ", ".join(worker["name"] for worker in snapshot["workers"])
        appointment_count = len(snapshot["appointments"])
        open_slot_count = len(snapshot["availableSlots"])
        return (
            f"{self._session_config['agent']['llmPrompt']}\n"
            f"Current doctors/resources: {workers}.\n"
            f"There are {appointment_count} scheduled appointments and {open_slot_count} open slots in the current scheduling snapshot.\n"
            "Use the appointment tools instead of inventing availability, bookings, or cancellations. Always confirm dates and times aloud before finishing."
        )

    async def connect(self) -> None:
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "OpenAI-Beta": "realtime=v1",
        }
        self._ws = await connect(OPENAI_URL, additional_headers=headers)
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "realtime",
                        "output_modalities": ["audio"],
                        "audio": {
                            "input": {
                                "turn_detection": {
                                    "type": "server_vad",
                                    "create_response": True,
                                    "interrupt_response": True,
                                },
                                "transcription": {
                                    "model": self._transcription_model,
                                    "prompt": self._transcription_prompt,
                                },
                            },
                            "output": {"voice": self._voice},
                        },
                        "instructions": self._instructions,
                        "tool_choice": "auto",
                        "tools": [
                            {
                                "type": "function",
                                "name": "list_workers",
                                "description": "List available medical workers/providers in the appointment system.",
                                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                            },
                            {
                                "type": "function",
                                "name": "list_appointments",
                                "description": "List scheduled appointments for the current appointment agent.",
                                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                            },
                            {
                                "type": "function",
                                "name": "list_available_slots",
                                "description": "List currently open appointment slots.",
                                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                            },
                            {
                                "type": "function",
                                "name": "book_appointment",
                                "description": "Book an appointment for the signed-in caller using a concrete slot id.",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "slot_id": {"type": "string"},
                                    },
                                    "required": ["slot_id"],
                                    "additionalProperties": False,
                                },
                            },
                            {
                                "type": "function",
                                "name": "cancel_appointment",
                                "description": "Cancel an existing appointment by appointment id.",
                                "parameters": {
                                    "type": "object",
                                    "properties": {"appointment_id": {"type": "string"}},
                                    "required": ["appointment_id"],
                                    "additionalProperties": False,
                                },
                            },
                        ],
                    },
                }
            )
        )

    async def run(self) -> None:
        try:
            while True:
                msg = await self._receive()
                if msg is None:
                    break
                await self.next.send(msg)
        except Exception:
            pass
        await self.next.send(Termination())

    async def _receive(self) -> Optional[Any]:
        try:
            while True:
                raw = await self._ws.recv()
                if raw is None:
                    return None
                msg = json.loads(raw)
                msg_type = msg.get("type")
                if msg_type in ("response.audio.delta", "response.output_audio.delta"):
                    audio = base64.b64decode(msg["delta"])
                    if self._soxr_out is not None:
                        audio_data = np.frombuffer(audio, dtype=np.int16)
                        resampled = self._soxr_out.resample_chunk(audio_data)
                        return resampled.astype(np.int16).tobytes()
                    return audio
                if msg_type == "input_audio_buffer.speech_started":
                    await self.next.send(ClearBuffer())
                if msg_type in (
                    "conversation.item.input_audio_transcription.completed",
                    "conversation.item.input_audio_transcript.completed",
                    "response.audio_transcript.done",
                    "response.output_audio_transcript.done",
                    "response.output_text.done",
                    "response.output_audio.done",
                    "response.done",
                    "response.created",
                    "input_audio_buffer.speech_started",
                    "input_audio_buffer.speech_stopped",
                ):
                    await self.next.send(ControlEvent(payload=msg))
                if msg_type == "response.function_call_arguments.done":
                    await self._handle_tool_call(
                        msg.get("name") or "",
                        msg.get("call_id") or "",
                        msg.get("arguments") or "{}",
                    )
                elif msg_type == "response.output_item.done" and msg.get("item", {}).get("type") == "function_call":
                    item = msg["item"]
                    await self._handle_tool_call(
                        item.get("name") or "",
                        item.get("call_id") or "",
                        item.get("arguments") or "{}",
                    )
        except ConnectionClosedOK:
            return None

    async def _handle_tool_call(self, name: str, call_id: str, raw_arguments: str) -> None:
        if not name or not call_id:
            return
        try:
            arguments = json.loads(raw_arguments or "{}")
        except json.JSONDecodeError:
            arguments = {}
        result = await self._tool_executor.execute(name, arguments)
        await self._ws.send(
            json.dumps(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": json.dumps(result),
                    },
                }
            )
        )
        await self._ws.send(json.dumps({"type": "response.create"}))

    async def send(self, data: Any) -> None:
        if isinstance(data, Termination):
            await self._ws.close()
            return
        if isinstance(data, STTResult):
            await self._ws.send(
                json.dumps(
                    {
                        "type": "conversation.item.create",
                        "item": {
                            "type": "message",
                            "role": "user",
                            "content": [{"type": "input_text", "text": data.text}],
                        },
                    }
                )
            )
            await self._ws.send(json.dumps({"type": "response.create"}))
            return
        if isinstance(data, ClearBuffer):
            await self.next.send(data)
            return
        if isinstance(data, bytes):
            audio = data
            if self._soxr_in is not None:
                audio_data = np.frombuffer(audio, dtype=np.int16)
                resampled = self._soxr_in.resample_chunk(audio_data)
                audio = resampled.astype(np.int16).tobytes()
            if audio:
                await self._ws.send(
                    json.dumps(
                        {
                            "type": "input_audio_buffer.append",
                            "audio": base64.b64encode(audio).decode("ascii"),
                        }
                    )
                )


class Pipeline:
    def __init__(self, params: PipelineParams):
        self._params = params
        self._transcript: list[str] = []
        self._started_at = utc_now_iso()
        self._tool_executor = AppointmentToolExecutor(params.session_config["callSession"]["id"])
        self._services: list[Any] = []

    async def run(self) -> None:
        await self._tool_executor.load()
        session_config = self._tool_executor.context
        self._params.session_config = session_config

        input_transport = InputTransport(self._params.ws)
        llm = OpenAIRealtime(session_config, self._params.sample_rate, self._handle_control_event, self._tool_executor)
        output_transport = OutputTransport(self._params.ws, self._params.sample_rate, self._handle_control_event)
        input_transport.next = llm
        llm.next = output_transport
        self._services = [input_transport, llm, output_transport]

        await asyncio.gather(*(service.connect() for service in self._services))
        await asyncio.gather(*(service.run() for service in self._services))
        await self._persist_call()

    def _append_transcript(self, speaker: str, text: Optional[str]) -> None:
        if not text:
            return
        cleaned = text.strip()
        if not cleaned:
            return
        self._transcript.append(f"{speaker}: {cleaned}")

    def _handle_control_event(self, payload: dict) -> None:
        event_type = payload.get("type")
        if event_type in (
            "conversation.item.input_audio_transcription.completed",
            "conversation.item.input_audio_transcript.completed",
        ):
            self._append_transcript("User", payload.get("transcript"))
        elif event_type in ("response.audio_transcript.done", "response.output_audio_transcript.done"):
            self._append_transcript("Agent", payload.get("transcript"))
        elif event_type == "response.output_text.done":
            self._append_transcript("Agent", payload.get("text"))

    async def _persist_call(self) -> None:
        context = self._tool_executor.context
        call_session = context["callSession"]
        agent = context["agent"]
        payload = {
            "runtimeSessionId": call_session["runtimeSessionId"],
            "organizationId": call_session["organizationId"],
            "platformUserId": call_session["platformUserId"],
            "agentId": agent["id"],
            "caller": "browser-client / appointment-agent-runtime",
            "status": "Completed" if self._transcript else "Escalated",
            "summary": " ".join(self._transcript[-2:])[:240] if self._transcript else "Voice session ended before transcript lines were captured.",
            "transcript": self._transcript,
            "startedAt": self._started_at,
            "endedAt": utc_now_iso(),
            "charactersIn": sum(len(line[6:]) for line in self._transcript if line.startswith("User: ")),
            "charactersOut": sum(len(line[7:]) for line in self._transcript if line.startswith("Agent: ")),
            "language": call_session.get("language"),
            "sttProvider": call_session.get("sttProvider"),
        }
        await post_json(
            f"{CONTROL_PLANE_BASE_URL}/api/internal/voice/calls",
            payload,
            CONTROL_PLANE_RUNTIME_TOKEN,
        )


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True})


@app.post("/api/chat")
async def chat(payload: dict, authorization: Optional[str] = Header(default=None)) -> JSONResponse:
    require_runtime_auth(authorization)
    message = str(payload.get("message") or "").strip()
    snapshot = payload.get("snapshot")
    if not message or not isinstance(snapshot, dict):
        raise HTTPException(status_code=400, detail="message and snapshot are required.")
    result = await run_ai_text_demo(snapshot, message)
    return JSONResponse(result)


@app.websocket("/ws")
@app.websocket("/")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    try:
        hello = await ws.receive_json()
    except Exception:
        await ws.close()
        return

    call_session_id = hello.get("sessionId")
    if not call_session_id:
        await ws.send_json({"error": "sessionId is required."})
        await ws.close()
        return

    try:
        session_config = await post_json(
            f"{CONTROL_PLANE_BASE_URL}/api/internal/appointment-agent/context",
            {"callSessionId": call_session_id},
            CONTROL_PLANE_RUNTIME_TOKEN,
        )
    except Exception as exc:
        await ws.send_json({"error": str(exc)})
        await ws.close()
        return

    params = PipelineParams(ws=ws, session_config=session_config, sample_rate=48000)
    pipeline = Pipeline(params)
    await pipeline.run()


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
