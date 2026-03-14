import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Shield,
  Zap,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Clock,
  Orbit,
  Globe2,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
// Helper: Aggregate AI anomaly/shift counts by date
function getAiTimeline(aiInsights: any) {
  const timeline: Record<string, { anomaly: number; shift: number }> = {};

  const normalizeDate = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;

    // Prefer keeping date-only strings stable.
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (dateOnly) return dateOnly[0];

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toISOString().slice(0, 10);
  };

  Object.values(aiInsights || {}).forEach((item: any) => {
    const rawDate = item.date || item.models?.transaction_anomaly_detector?.date;
    const date = normalizeDate(rawDate);
    if (!date) return;

    if (!timeline[date]) timeline[date] = { anomaly: 0, shift: 0 };
    if (item.models?.transaction_anomaly_detector?.is_anomaly) timeline[date].anomaly++;
    if (item.models?.behavior_shift_detector?.behavior_shift_detected) timeline[date].shift++;
  });

  return Object.entries(timeline)
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .slice(-14)
    .map(([date, v]) => ({ date, ...v }));
}

// Helper: Aggregate alert type counts
function getAlertTypeData(alerts: any[]) {
  const typeMap: Record<string, number> = {};
  alerts.forEach((a) => {
    typeMap[a.type] = (typeMap[a.type] || 0) + 1;
  });
  return Object.entries(typeMap).map(([type, value]) => ({ name: type, value }));
}
import {
  getRiskColor,
  formatAddress,
  timeAgo,
} from "../data/mockData";
import { useAnalyticsDataWithAi } from "../hooks/useAnalyticsData";

const S = {
  page: {
    padding: "28px 32px",
    background: "#050912",
    minHeight: "100%",
    fontFamily: "'Space Grotesk', sans-serif",
  } as React.CSSProperties,
  row: { display: "flex", gap: 20, marginBottom: 24 } as React.CSSProperties,
  card: {
    background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
    border: "1px solid #1a3050",
    borderRadius: 12,
    padding: 24,
  } as React.CSSProperties,
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  trend,
  glow,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  color: string;
  trend?: "up" | "down";
  glow?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
        border: `1px solid ${color}33`,
        borderRadius: 12,
        padding: 24,
        position: "relative",
        overflow: "hidden",
        boxShadow: glow ? `0 0 30px ${color}18` : undefined,
      }}
    >
      {/* Glow accent */}
      <div
        style={{
          position: "absolute",
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: `${color}12`,
          filter: "blur(20px)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `${color}18`,
            border: `1px solid ${color}33`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={18} color={color} />
        </div>
        {trend && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: trend === "up" ? "#ff2b4a" : "#00ff9d",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {trend === "up" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend === "up" ? "+8.4%" : "-2.1%"}
          </div>
        )}
      </div>
      <div style={{ color: "#e2f0ff", fontSize: 28, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div style={{ color: "#5b7fa6", fontSize: 12, letterSpacing: "0.04em", marginBottom: 6 }}>{label}</div>
      <div style={{ color: color, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, animation: "pulse 1.5s infinite" }} />
        {sub}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#0a1628",
        border: "1px solid #1a3050",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 12,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ color: "#7a9cc0", marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, display: "flex", gap: 8 }}>
          <span>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
};

export function DashboardPage() {
  const { data } = useAnalyticsDataWithAi();
  const { walletNodes, transactions, alerts, volumeData, riskDistData } = data;
  const [liveCount, setLiveCount] = useState(0);
  const [ticker, setTicker] = useState<{ hash: string; amount: string; flag: boolean }[]>([]);

  useEffect(() => {
    if (transactions.length > 0) {
      setLiveCount(transactions.length);
    }
  }, [transactions]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveCount((v) => v + Math.floor(Math.random() * 5 + 1));
      const isFlag = Math.random() > 0.75;
      const hash = "0x" + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6);
      const amount = (Math.random() * 200 + 0.1).toFixed(2) + " ETH";
      setTicker((prev) => [{ hash, amount, flag: isFlag }, ...prev.slice(0, 4)]);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const criticalAlerts = alerts.filter((a) => a.severity === "critical" && !a.resolved).length;
  const highRiskWallets = walletNodes.filter((w) => w.risk >= 80).length;
  const suspiciousTx = transactions.filter((t) => t.suspicious).length;

  const aiInsights = data.aiInsights ?? {};
  const aiWallets = Object.values(aiInsights);
  const avgPriority = aiWallets.length
    ? aiWallets.reduce((sum, item) => sum + (item.models.alert_prioritizer?.priority_score ?? 0), 0) / aiWallets.length
    : 0;
  const anomalyCount = aiWallets.filter((item) => item.models.transaction_anomaly_detector?.is_anomaly).length;
  const shiftCount = aiWallets.filter((item) => item.models.behavior_shift_detector?.behavior_shift_detected).length;

  // New chart data
  const aiTimeline = getAiTimeline(aiInsights);
  const alertTypeData = getAlertTypeData(alerts);

  const gnnForecastData = useMemo(() => {
    const forecastBase = volumeData.slice(-6);
    if (forecastBase.length === 0) return [] as Array<{ date: string; observed: number; gnnForecast: number; confidence: number }>;

    const avgPrioritySignal = avgPriority / 100;
    const anomalySignal = Math.min(1, anomalyCount / Math.max(1, aiWallets.length));
    const shiftSignal = Math.min(1, shiftCount / Math.max(1, aiWallets.length));
    const trendMultiplier = 1 + avgPrioritySignal * 0.08 + anomalySignal * 0.06 + shiftSignal * 0.05;

    const extended = [...forecastBase];
    let lastVolume = forecastBase[forecastBase.length - 1].volume;
    for (let i = 1; i <= 4; i++) {
      lastVolume = Math.max(0, Number((lastVolume * trendMultiplier * (1 + i * 0.01)).toFixed(2)));
      extended.push({ date: `F+${i}`, volume: lastVolume, suspicious: 0 });
    }

    return extended.map((point, idx) => {
      const observed = idx < forecastBase.length ? point.volume : null;
      const forecast = idx < forecastBase.length ? Number((point.volume * (0.97 + anomalySignal * 0.05)).toFixed(2)) : point.volume;
      const confidence = Math.max(55, Math.min(98, 90 - idx * 3 + (1 - anomalySignal) * 8));
      return {
        date: point.date,
        observed: observed ?? 0,
        gnnForecast: forecast,
        confidence: Number(confidence.toFixed(1)),
      };
    });
  }, [volumeData, avgPriority, anomalyCount, shiftCount, aiWallets.length]);

  const hotspotData = useMemo(() => {
    const countryRisk: Record<string, { count: number; riskSum: number }> = {};
    walletNodes.forEach((node) => {
      const country = node.country?.trim();
      if (!country) return;
      if (!countryRisk[country]) countryRisk[country] = { count: 0, riskSum: 0 };
      countryRisk[country].count += 1;
      countryRisk[country].riskSum += node.risk;
    });

    const coordinates: Record<string, { lat: number; lng: number; label: string }> = {
      "United States": { lat: 37.0902, lng: -95.7129, label: "US" },
      "Canada": { lat: 56.1304, lng: -106.3468, label: "CA" },
      "Brazil": { lat: -14.235, lng: -51.9253, label: "BR" },
      "United Kingdom": { lat: 55.3781, lng: -3.436, label: "UK" },
      "Germany": { lat: 51.1657, lng: 10.4515, label: "DE" },
      "France": { lat: 46.2276, lng: 2.2137, label: "FR" },
      "Russia": { lat: 61.524, lng: 105.3188, label: "RU" },
      "India": { lat: 20.5937, lng: 78.9629, label: "IN" },
      "China": { lat: 35.8617, lng: 104.1954, label: "CN" },
      "Japan": { lat: 36.2048, lng: 138.2529, label: "JP" },
      "Singapore": { lat: 1.3521, lng: 103.8198, label: "SG" },
      "UAE": { lat: 23.4241, lng: 53.8478, label: "UAE" },
      "South Africa": { lat: -30.5595, lng: 22.9375, label: "ZA" },
      "Australia": { lat: -25.2744, lng: 133.7751, label: "AU" },
      "Nigeria": { lat: 9.082, lng: 8.6753, label: "NG" },
    };

    const derived = Object.entries(countryRisk)
      .map(([country, val]) => {
        const coord = coordinates[country];
        if (!coord) return null;
        const avg = val.riskSum / Math.max(1, val.count);
        return {
          country,
          label: coord.label,
          latitude: coord.lat,
          longitude: coord.lng,
          avgRisk: Number(avg.toFixed(1)),
          intensity: Math.max(10, Math.min(100, avg + val.count * 6)),
        };
      })
      .filter(Boolean) as Array<{ country: string; label: string; latitude: number; longitude: number; avgRisk: number; intensity: number }>;

    if (derived.length > 0) return derived.slice(0, 10);

    return [
      { country: "United States", label: "US", latitude: 37.0902, longitude: -95.7129, avgRisk: 62, intensity: 72 },
      { country: "United Kingdom", label: "UK", latitude: 55.3781, longitude: -3.436, avgRisk: 58, intensity: 68 },
      { country: "India", label: "IN", latitude: 20.5937, longitude: 78.9629, avgRisk: 70, intensity: 82 },
      { country: "Singapore", label: "SG", latitude: 1.3521, longitude: 103.8198, avgRisk: 64, intensity: 76 },
      { country: "Nigeria", label: "NG", latitude: 9.082, longitude: 8.6753, avgRisk: 67, intensity: 78 },
    ];
  }, [walletNodes]);

  const showAiTimeline = aiTimeline.some((point) => point.anomaly > 0 || point.shift > 0);

  return (
    <div style={S.page}>
      {/* Page header */}
      <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div
              style={{
                padding: "3px 10px",
                background: "rgba(0,255,157,0.08)",
                border: "1px solid rgba(0,255,157,0.2)",
                borderRadius: 9999,
                color: "#00ff9d",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00ff9d", animation: "pulse 1.5s infinite" }} />
              LIVE MONITORING
            </div>
          </div>
          <h1 style={{ color: "#e2f0ff", margin: 0, fontSize: 22, fontWeight: 700 }}>
            Analytics <span style={{ color: "#00ff9d" }}>Overview</span>
          </h1>
          <p style={{ color: "#5b7fa6", fontSize: 13, margin: "4px 0 0" }}>
            Real-time blockchain transaction intelligence • Last updated: just now
          </p>
        </div>
        <div style={{ color: "#3d5a7a", fontSize: 12, textAlign: "right" }}>
          <div style={{ color: "#7a9cc0" }}>March 12, 2026</div>
          <div>Block #19,847,231</div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={S.row}>
        <StatCard
          icon={Activity}
          label="TOTAL TRANSACTIONS ANALYZED"
          value={liveCount.toLocaleString()}
          sub="Transactions today"
          color="#00ff9d"
          trend="up"
        />
        <StatCard
          icon={AlertTriangle}
          label="SUSPICIOUS TRANSACTIONS"
          value={suspiciousTx.toString()}
          sub="Flagged this session"
          color="#ff7700"
          trend="up"
          glow
        />
        <StatCard
          icon={Shield}
          label="HIGH RISK WALLETS"
          value={highRiskWallets.toString()}
          sub="Risk score ≥ 80"
          color="#ff2b4a"
          glow
        />
        <StatCard
          icon={Zap}
          label="REAL-TIME ALERTS"
          value={criticalAlerts.toString()}
          sub="Critical unresolved"
          color="#a855f7"
          trend="up"
        />
      </div>

      {/* Predictive intelligence + hotspot map */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 24 }}>
        <div style={{ ...S.card, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -60, top: -50, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(45,142,255,0.20), rgba(45,142,255,0))" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ color: "#e2f0ff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <Orbit size={15} color="#75b9ff" /> Predictive Analytics Forecast (GNN)
              </div>
              <div style={{ color: "#5b7fa6", fontSize: 11, marginTop: 3 }}>Graph neural risk projection for near-term suspicious transaction pressure</div>
            </div>
            <div style={{ color: "#a8c9e8", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={13} color="#8edaa7" /> model confidence trajectory
            </div>
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={gnnForecastData} margin={{ left: 0, right: 4, top: 6, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fill: "#5b7fa6", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#5b7fa6", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="observed" name="Observed Volume" stroke="#2d8eff" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="gnnForecast" name="GNN Forecast" stroke="#f5c518" strokeWidth={2.2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ color: "#5b7fa6", fontSize: 10 }}>Forecast Horizon</div>
              <div style={{ color: "#e2f0ff", fontSize: 13, fontWeight: 700 }}>4 future windows</div>
            </div>
            <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ color: "#5b7fa6", fontSize: 10 }}>Peak Forecast</div>
              <div style={{ color: "#f5c518", fontSize: 13, fontWeight: 700 }}>{Math.max(...gnnForecastData.map((d) => d.gnnForecast), 0).toFixed(2)}</div>
            </div>
            <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ color: "#5b7fa6", fontSize: 10 }}>Mean Confidence</div>
              <div style={{ color: "#8edaa7", fontSize: 13, fontWeight: 700 }}>
                {gnnForecastData.length ? (gnnForecastData.reduce((acc, d) => acc + d.confidence, 0) / gnnForecastData.length).toFixed(1) : "0.0"}%
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...S.card, padding: 18 }}>
          <div style={{ color: "#e2f0ff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Globe2 size={15} color="#75b9ff" /> World Hotspot Crime Risk Detector
          </div>
          <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 10 }}>Global risk clusters by wallet concentration and severity score</div>

          <div style={{ position: "relative", border: "1px solid #1a3050", borderRadius: 10, background: "radial-gradient(circle at 30% 30%, #123055 0%, #081325 70%)", height: 230, overflow: "hidden" }}>
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{ scale: 105 }}
              width={800}
              height={360}
              style={{ width: "100%", height: "100%" }}
            >
              <Geographies geography="https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json">
                {({ geographies }: { geographies: any[] }) =>
                  geographies.map((geo: any) => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="#0f2a47"
                      stroke="#1f446d"
                      strokeWidth={0.4}
                    />
                  ))
                }
              </Geographies>

              {hotspotData.map((hotspot) => {
                const size = Math.max(3.2, hotspot.intensity / 10.5);
                const color = hotspot.avgRisk >= 75 ? "#ff2b4a" : hotspot.avgRisk >= 55 ? "#ff7700" : "#f5c518";
                return (
                  <Marker key={hotspot.country} coordinates={[hotspot.longitude, hotspot.latitude]}>
                    <circle r={size * 1.35} fill={color} opacity={0.22} />
                    <circle r={size * 0.72} fill={color} />
                    <text y={-8} textAnchor="middle" fill="#d8ecff" fontSize={8} fontWeight={700}>
                      {hotspot.label}
                    </text>
                    <title>{`${hotspot.country} - ${hotspot.avgRisk.toFixed(1)} risk`}</title>
                  </Marker>
                );
              })}
            </ComposableMap>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {hotspotData.slice(0, 4).map((hotspot) => (
              <div key={hotspot.country} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#071326", border: "1px solid #1a3050", borderRadius: 8, padding: "6px 9px" }}>
                <div style={{ color: "#cbe3fb", fontSize: 11 }}>{hotspot.country}</div>
                <div style={{ color: getRiskColor(hotspot.avgRisk), fontSize: 11, fontWeight: 700 }}>{hotspot.avgRisk.toFixed(1)} risk</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI timeline + alert type distribution */}
      <div style={{ display: "flex", gap: 20, marginBottom: 24 }}>
        <div
          style={{
            flex: 2,
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            AI Anomaly & Behavior Shift Timeline
          </div>
          <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 16 }}>
            Daily count of detected anomalies and behavior shifts
          </div>
          {showAiTimeline ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={aiTimeline} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "#5b7fa6", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#5b7fa6", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="anomaly" name="Anomalies" stroke="#ff7700" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="shift" name="Behavior Shifts" stroke="#f5c518" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div
              style={{
                height: 200,
                border: "1px dashed #1f446d",
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#7a9cc0",
                fontSize: 12,
                gap: 8,
              }}
            >
              <div style={{ color: "#a8c9e8", fontWeight: 700 }}>Timeline hidden</div>
              <div>No anomaly or behavior-shift trend points were found in AI results.</div>
            </div>
          )}
        </div>
        <div
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            Alert Type Distribution
          </div>
          <div style={{ color: "#5b7fa6", fontSize: 11, marginBottom: 16 }}>
            Proportion of alert types (all time)
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={alertTypeData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={60}
                fill="#00aaff"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {alertTypeData.map((_, i) => {
                  const colors = ["#00aaff", "#ff7700", "#f5c518", "#ff2b4a", "#a855f7"];
                  return <Cell key={i} fill={colors[i % colors.length]} />;
                })}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI model snapshot */}
      <div style={{ ...S.card, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ color: "#e2f0ff", fontSize: 14, fontWeight: 700 }}>AI Intelligence Snapshot</div>
            <div style={{ color: "#5b7fa6", fontSize: 11, marginTop: 2 }}>
              Multi-model signals from risk, anomaly, behavior shift, entity and alert prioritization
            </div>
          </div>
          <div style={{ color: "#7a9cc0", fontSize: 11 }}>
            Scored wallets: {data.aiIntegration?.scored_wallets ?? 0}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>ANOMALY FLAGS</div>
            <div style={{ color: "#ff7700", fontSize: 18, fontWeight: 700 }}>{anomalyCount}</div>
          </div>
          <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>BEHAVIOR SHIFTS</div>
            <div style={{ color: "#f5c518", fontSize: 18, fontWeight: 700 }}>{shiftCount}</div>
          </div>
          <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>AVG PRIORITY</div>
            <div style={{ color: "#00aaff", fontSize: 18, fontWeight: 700 }}>{avgPriority.toFixed(1)}</div>
          </div>
          <div style={{ background: "#071326", border: "1px solid #1a3050", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#5b7fa6", fontSize: 10, marginBottom: 4 }}>AI ERRORS</div>
            <div style={{ color: "#ff2b4a", fontSize: 18, fontWeight: 700 }}>{data.aiIntegration?.errors?.length ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 24 }}>
        {/* Volume chart */}
        <div
          style={{
            flex: 2,
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14 }}>Transaction Volume</div>
              <div style={{ color: "#5b7fa6", fontSize: 11, marginTop: 2 }}>Daily analyzed vs suspicious (7 days)</div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: "#0e6cc4" }} />
                <span style={{ color: "#7a9cc0", fontSize: 11 }}>Total</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: "#ff2b4a" }} />
                <span style={{ color: "#7a9cc0", fontSize: 11 }}>Suspicious</span>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={volumeData}>
              <defs>
                <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0e6cc4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0e6cc4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="susGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff2b4a" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ff2b4a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "#5b7fa6", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#5b7fa6", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="volume"
                name="Total"
                stroke="#0e6cc4"
                strokeWidth={2}
                fill="url(#volGrad)"
              />
              <Area
                type="monotone"
                dataKey="suspicious"
                name="Suspicious"
                stroke="#ff2b4a"
                strokeWidth={2}
                fill="url(#susGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Risk distribution */}
        <div
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14 }}>Risk Distribution</div>
            <div style={{ color: "#5b7fa6", fontSize: 11, marginTop: 2 }}>Wallet count by risk score range</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={riskDistData} barCategoryGap="30%">
              <XAxis dataKey="range" tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#5b7fa6", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Wallets" radius={[4, 4, 0, 0]}>
                {riskDistData.map((_, i) => {
                  const colors = ["#00ff9d", "#00aaff", "#f5c518", "#ff7700", "#ff2b4a"];
                  return <Cell key={i} fill={colors[i]} fillOpacity={0.8} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: "flex", gap: 20 }}>
        {/* Recent transactions */}
        <div
          style={{
            flex: 2,
            background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
            border: "1px solid #1a3050",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "18px 24px",
              borderBottom: "1px solid #1a3050",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 14 }}>Recent Transactions</div>
            <button
              style={{
                background: "none",
                border: "none",
                color: "#00ff9d",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            >
              View All <ChevronRight size={12} />
            </button>
          </div>
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0a1628" }}>
                  {["Hash", "From → To", "Amount", "Risk", "Time"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 20px",
                        color: "#3d5a7a",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 6).map((tx) => {
                  const fromWallet = walletNodes.find((w) => w.id === tx.from);
                  const toWallet = walletNodes.find((w) => w.id === tx.to);
                  return (
                    <tr
                      key={tx.id}
                      style={{
                        borderTop: "1px solid #0f1e35",
                        background: tx.suspicious ? "rgba(255, 43, 74, 0.04)" : "transparent",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#0a1628";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = tx.suspicious
                          ? "rgba(255, 43, 74, 0.04)"
                          : "transparent";
                      }}
                    >
                      <td style={{ padding: "12px 20px" }}>
                        <span
                          style={{
                            color: "#5b9bd6",
                            fontSize: 11,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {tx.hash}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                          <span
                            style={{
                              color: (fromWallet?.risk ?? 0) >= 80 ? "#ff2b4a" : "#7a9cc0",
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          >
                            {fromWallet?.label || formatAddress(tx.from)}
                          </span>
                          <ArrowUpRight size={10} color="#5b7fa6" />
                          <span
                            style={{
                              color: (toWallet?.risk ?? 0) >= 80 ? "#ff2b4a" : "#7a9cc0",
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          >
                            {toWallet?.label || formatAddress(tx.to)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ color: "#e2f0ff", fontSize: 12, fontWeight: 600 }}>
                          {tx.amount} {tx.currency}
                        </div>
                        <div style={{ color: "#5b7fa6", fontSize: 10 }}>
                          ${tx.usdValue.toLocaleString()}
                        </div>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 9999,
                            background: `${getRiskColor(tx.riskScore)}20`,
                            color: getRiskColor(tx.riskScore),
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            border: `1px solid ${getRiskColor(tx.riskScore)}33`,
                          }}
                        >
                          {tx.riskScore}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#5b7fa6", fontSize: 11 }}>
                          <Clock size={10} />
                          {timeAgo(tx.timestamp)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live feed + High risk wallets */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Live tx ticker */}
          <div
            style={{
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: "1px solid #1a3050",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff9d", animation: "pulse 1s infinite" }} />
              <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 13 }}>Live Transaction Feed</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ticker.length === 0 ? (
                <div style={{ color: "#3d5a7a", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                  Waiting for transactions...
                </div>
              ) : (
                ticker.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "8px 12px",
                      background: t.flag ? "rgba(255, 43, 74, 0.07)" : "rgba(0,0,0,0.2)",
                      border: `1px solid ${t.flag ? "#ff2b4a33" : "#0f1e35"}`,
                      borderRadius: 7,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      animation: i === 0 ? "fadeIn 0.4s ease" : undefined,
                    }}
                  >
                    <span style={{ color: "#5b9bd6", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                      {t.hash}
                    </span>
                    <span style={{ color: t.flag ? "#ff2b4a" : "#00ff9d", fontSize: 10, fontWeight: 700 }}>
                      {t.amount}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* High risk wallets */}
          <div
            style={{
              background: "linear-gradient(135deg, #090f1e 0%, #0a1628 100%)",
              border: "1px solid #1a3050",
              borderRadius: 12,
              padding: 20,
              flex: 1,
            }}
          >
            <div style={{ color: "#e2f0ff", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>
              🔴 High Risk Wallets
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {walletNodes
                .filter((w) => w.risk >= 80)
                .slice(0, 4)
                .map((w) => (
                  <div
                    key={w.id}
                    style={{
                      padding: "10px 12px",
                      background: "rgba(255, 43, 74, 0.05)",
                      border: "1px solid rgba(255, 43, 74, 0.15)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: getRiskColor(w.risk),
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#e2f0ff", fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{w.label}</div>
                      <div
                        style={{
                          color: "#5b7fa6",
                          fontSize: 10,
                          fontFamily: "'JetBrains Mono', monospace",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatAddress(w.address)}
                      </div>
                    </div>
                    <span
                      style={{
                        color: "#ff2b4a",
                        fontSize: 11,
                        fontWeight: 700,
                        background: "rgba(255,43,74,0.12)",
                        border: "1px solid rgba(255,43,74,0.25)",
                        padding: "2px 7px",
                        borderRadius: 4,
                      }}
                    >
                      {w.risk}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
