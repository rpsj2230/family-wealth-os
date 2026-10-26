/** A bar split into parts of a whole (used, planned, free), with a legend that says each amount so colour is never the only signal. */
export function Meter({
  total,
  parts,
  format,
}: {
  total: number;
  parts: { label: string; value: number; colour: string }[];
  format: (n: number) => string;
}) {
  const sum = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const base = Math.max(total, sum, 1);
  return (
    <div className="meter">
      <div
        className="meter-bar"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}
      >
        {parts.map((p) => (
          <span
            key={p.label}
            style={{ width: `${(Math.max(0, p.value) / base) * 100}%`, background: p.colour }}
          />
        ))}
      </div>
      <ul className="meter-legend small">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="swatch" style={{ background: p.colour }} aria-hidden="true" />
            {p.label} <b className="num">{format(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
