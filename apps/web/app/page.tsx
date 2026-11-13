import { recentOperations, spentTodayUsd } from "@hephaestus/core";
import { db } from "../lib/db";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const int = (n: number) => n.toLocaleString("en-US");

export default async function LedgerPage() {
  const [ops, today] = await Promise.all([recentOperations(db, 200), spentTodayUsd(db)]);
  const total = ops.reduce((s, o) => s + Number(o.costUsd), 0);
  const finished = ops.filter((o) => o.status !== "running");
  const passRate = finished.length ? finished.filter((o) => o.status === "succeeded").length / finished.length : 0;

  return (
    <>
      <section className="tiles">
        <div className="tile">
          <div className="muted">Spend today (UTC)</div>
          <div className="v">{usd(today)}</div>
        </div>
        <div className="tile">
          <div className="muted">Spend, last {ops.length} ops</div>
          <div className="v">{usd(total)}</div>
        </div>
        <div className="tile">
          <div className="muted">Operations</div>
          <div className="v">{int(ops.length)}</div>
        </div>
        <div className="tile">
          <div className="muted">Pass rate</div>
          <div className="v">{finished.length ? `${Math.round(passRate * 100)}%` : "—"}</div>
        </div>
      </section>

      {ops.length === 0 ? (
        <p className="muted">
          No operations yet. Label an issue <code>factory:approved</code> in a watched repo and start the worker.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Story</th>
              <th>Persona</th>
              <th>Category</th>
              <th>Model</th>
              <th>Runtime</th>
              <th className="num">Attempt</th>
              <th>Status</th>
              <th className="num">In tok</th>
              <th className="num">Out tok</th>
              <th className="num">Cache read</th>
              <th className="num">Duration</th>
              <th className="num">Cost</th>
              <th>Cost source</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => (
              <tr key={o.id} title={o.description}>
                <td>{o.startedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{o.storyRef ?? "—"}</td>
                <td>{o.persona}</td>
                <td>{o.category}</td>
                <td>{o.model}</td>
                <td>{o.runtime}</td>
                <td className="num">{o.attempt}</td>
                <td className={`s-${o.status}`}>{o.status}</td>
                <td className="num">{int(o.inputTokens)}</td>
                <td className="num">{int(o.outputTokens)}</td>
                <td className="num">{int(o.cacheReadTokens)}</td>
                <td className="num">{o.durationMs == null ? "—" : `${(o.durationMs / 1000).toFixed(1)}s`}</td>
                <td className="num">{usd(Number(o.costUsd))}</td>
                <td className="muted">
                  {o.costSource ?? "—"}
                  {o.computedCostUsd && o.costSource === "provider" ? ` (calc ${usd(Number(o.computedCostUsd))})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
