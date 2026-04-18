import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { CATEGORY_META } from "./ScoreBadge.jsx";

const COLORS = {
  explicit_correction: "#f85149",
  course_change: "#58a6ff",
  frustration: "#d29922",
  repetition: "#bc8cff",
  rollback: "#db6d28",
};

export function CategoryBreakdown({ categoryTotals }) {
  if (!categoryTotals || Object.keys(categoryTotals).length === 0) {
    return (
      <div className="empty">
        <p>No category data available.</p>
      </div>
    );
  }

  const data = Object.entries(categoryTotals).map(([key, val]) => ({
    name: CATEGORY_META[key]?.label || key,
    value: val.count,
    key,
  }));

  const total = data.reduce((s, d) => s + d.value, 0);

  const renderLegend = ({ payload }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4 }}>
      {payload.map((entry) => {
        const pct = total > 0 ? ((entry.payload.value / total) * 100).toFixed(0) : 0;
        return (
          <div key={entry.value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: entry.color, flexShrink: 0 }} />
            <span style={{ color: "#e6edf3" }}>{entry.value}</span>
            <span style={{ color: "#8b949e", marginLeft: "auto" }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "12px 0" }}>
      <PieChart width={200} height={200}>
        <Pie
          data={data}
          cx={100}
          cy={100}
          innerRadius={45}
          outerRadius={85}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry) => (
            <Cell
              key={entry.key}
              fill={COLORS[entry.key] || "#8b949e"}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            color: "#e6edf3",
          }}
          formatter={(value, name) => [`${value} (${total > 0 ? ((value / total) * 100).toFixed(0) : 0}%)`, name]}
        />
      </PieChart>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
        {data.map((d) => {
          const pct = total > 0 ? ((d.value / total) * 100).toFixed(0) : 0;
          return (
            <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS[d.key] || "#8b949e", flexShrink: 0 }} />
              <span style={{ color: "#e6edf3", flex: 1 }}>{d.name}</span>
              <span style={{ color: "#8b949e", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
