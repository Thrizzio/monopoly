import { useEffect, useState } from "react";
import { STARTING_CASH, PASS_GO_AMOUNT } from "@monopolisting/shared";

export default function App() {
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api/health`)
      .then((r) => r.json())
      .then((d: { database: string }) => setHealth(d.database))
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">Monopoly Online</h1>
      <p className="mt-2 text-slate-700">Phase 1 foundation is running.</p>
      <ul className="mt-4 list-disc pl-6 text-slate-800">
        <li>Starting cash: ${STARTING_CASH}</li>
        <li>Pass GO: ${PASS_GO_AMOUNT}</li>
        <li>API database: {health}</li>
      </ul>
    </main>
  );
}
