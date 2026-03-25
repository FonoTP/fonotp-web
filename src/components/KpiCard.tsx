type KpiCardProps = {
  label: string;
  value: string;
  detail: string;
};

export function KpiCard({ label, value, detail }: KpiCardProps) {
  return (
    <article className="panel kpi-card">
      <p className="kpi-label">{label}</p>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-detail">{detail}</span>
    </article>
  );
}
