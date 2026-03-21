interface SyncProgressBarProps {
  total: number;
  completed: number;
  currentOp: string;
}

export function SyncProgressBar({ total, completed, currentOp }: SyncProgressBarProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {completed} из {total}
          {currentOp ? ` — ${currentOp}` : ""}
        </span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
