import { useEffect, useState } from "react";
import { fetchAnalyticsPayload, fetchAnalyticsPayloadWithAi, type AnalyticsPayload } from "../api/analyticsApi";

interface AnalyticsHookOptions {
  pollMs?: number;
}

const EMPTY_ANALYTICS: AnalyticsPayload = {
  walletNodes: [],
  transactions: [],
  alerts: [],
  volumeData: [],
  riskDistData: [],
  hourlyAlerts: [],
};

export function useAnalyticsData(options: AnalyticsHookOptions = {}) {
  const pollMs = Math.max(0, options.pollMs ?? 0);
  const [data, setData] = useState<AnalyticsPayload>(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function load(showLoader = false) {
      if (showLoader) {
        setLoading(true);
      }
      setError(null);
      try {
        const payload = await fetchAnalyticsPayload();
        if (mounted) {
          setData(payload);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Unable to load analytics data.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load(true);

    if (pollMs > 0) {
      intervalId = setInterval(() => {
        void load(false);
      }, pollMs);
    }

    return () => {
      mounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pollMs]);

  return { data, loading, error };
}

export function useAnalyticsDataWithAi(options: AnalyticsHookOptions = {}) {
  const pollMs = Math.max(0, options.pollMs ?? 0);
  const [data, setData] = useState<AnalyticsPayload>(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function load(showLoader = false) {
      if (showLoader) {
        setLoading(true);
      }
      setError(null);
      try {
        const payload = await fetchAnalyticsPayloadWithAi();
        if (mounted) {
          setData(payload);
        }
      } catch (err) {
        // Fall back to the standard analytics endpoint when AI enrichment is unavailable.
        let fallbackLoaded = false;
        try {
          const fallback = await fetchAnalyticsPayload();
          if (mounted) {
            setData(fallback);
            fallbackLoaded = true;
          }
        } catch {
          // Keep original error below.
        }
        if (mounted && !fallbackLoaded) {
          setError(err instanceof Error ? err.message : "Unable to load AI analytics data.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load(true);

    if (pollMs > 0) {
      intervalId = setInterval(() => {
        void load(false);
      }, pollMs);
    }

    return () => {
      mounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pollMs]);

  return { data, loading, error };
}