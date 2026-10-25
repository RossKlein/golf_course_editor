import type { Report } from "../api/api";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

/** A bundle validation report: verdict, problems, and the per-file size breakdown. */
export default function ReportView({ report }: { report: Report }) {
  return (
    <div className="report">
      <p className={report.ok ? "ok" : "error"}>
        {report.ok ? "Valid bundle" : `${report.errors.length} error(s)`} · {mb(report.total_bytes)}
      </p>
      {report.errors.map((e) => (
        <p key={e} className="error">{e}</p>
      ))}
      {report.warnings.map((w) => (
        <p key={w} className="warn">{w}</p>
      ))}
      <table className="info">
        <tbody>
          {Object.entries(report.sizes)
            .sort()
            .map(([file, size]) => (
              <tr key={file}><td>{file}</td><td>{mb(size)}</td></tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
