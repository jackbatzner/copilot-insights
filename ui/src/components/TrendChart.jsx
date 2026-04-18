import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export function TrendChart({ trends }) {
  if (!trends || trends.length === 0) {
    return (
      <div className="empty">
        <p>Not enough data for trend analysis yet.</p>
      </div>
    );
  }

  const data = trends.map((t) => ({
    ...t,
    ratePercent: +(t.redirectionRate * 100).toFixed(1),
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="rateGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#8b949e", fontSize: 12 }}
          tickFormatter={(d) => {
            const parts = d.split("-");
            return `${parts[1]}/${parts[2]}`;
          }}
        />
        <YAxis
          tick={{ fill: "#8b949e", fontSize: 12 }}
          tickFormatter={(v) => `${v}%`}
          domain={[0, "auto"]}
        />
        <Tooltip
          contentStyle={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            color: "#e6edf3",
          }}
          formatter={(val) => [`${val}%`, "Redirection Rate"]}
        />
        <Area
          type="monotone"
          dataKey="ratePercent"
          stroke="#58a6ff"
          strokeWidth={2}
          fill="url(#rateGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
