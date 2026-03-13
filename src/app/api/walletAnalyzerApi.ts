export interface SuspiciousTransaction {
  hash: string;
  from: string;
  to: string;
  value_eth: number;
  timestamp: string;
  reasons: string[];
}

export interface FlowTransaction {
  hash: string;
  from: string;
  to: string;
  value_eth: number;
  timestamp: string;
  is_error: boolean;
}

export interface WalletAnalysisResponse {
  wallet_address: string;
  total_transactions: number;
  suspicious_transactions: SuspiciousTransaction[];
  risk_score: number;
  transaction_flow: FlowTransaction[];
  explainability?: {
    decision: "flagged" | "monitor" | "low_risk";
    summary: string;
    reasons: string[];
    signals?: {
      high_risk_counterparties: number;
      suspicious_transaction_ratio: number;
      large_transactions: number;
    };
  };
  threat_intelligence?: {
    checked_addresses: number;
    flagged_addresses: number;
    sources: string[];
    matches: Array<{
      address: string;
      is_flagged: boolean;
      risk_level: string;
      score_boost: number;
      hits: Array<{
        source: string;
        dataset: string;
        match_type: string;
        confidence: string;
        report_count?: number;
        evidence?: {
          categories?: string[];
          notes?: string[];
        };
      }>;
    }>;
  };
  investigation_report?: {
    metadata: {
      system: string;
      generated_by: string;
      date: string;
      report_id: string;
      network: string;
    };
    wallet_information: {
      wallet_address: string;
      blockchain_network: string;
      total_transactions: number;
      first_transaction: string;
      last_transaction: string;
    };
    risk_assessment: {
      risk_score: number;
      risk_level: string;
      indicators_detected: string[];
    };
    suspicious_transaction_summary: {
      suspicious_count: number;
      example_transactions: Array<{
        transaction_hash: string;
        amount_eth: number;
        date: string;
      }>;
    };
    transaction_flow_analysis: {
      transaction_path: string;
      possible_pattern: string;
    };
    executive_summary: string;
    ai_investigation_insight: string;
    recommended_actions: string[];
    disclaimer: string;
    classification: "High Risk" | "Medium Risk" | "Low Risk";
    visuals: {
      signal_breakdown: Array<{ name: string; value: number }>;
    };
    report_text: string;
    legacy_report_text?: string;
  } | null;
}

export interface MlStatusResponse {
  model_path: string;
  model_available: boolean;
}

export interface MlPredictionResponse {
  wallet_address?: string;
  prediction: number;
  risk_probability: number;
  risk_score: number;
  used_features: string[];
}

export interface MlAllFeaturesResponse {
  wallet_address: string;
  models: {
    wallet_risk_classifier?: {
      prediction: number;
      risk_probability: number;
      risk_score: number;
    };
    transaction_anomaly_detector?: {
      is_anomaly: boolean;
      raw_label: number;
      anomaly_score: number;
    };
    counterparty_contagion_regressor?: {
      contagion_score: number;
    };
    behavior_shift_detector?: {
      behavior_shift_detected: boolean;
      raw_label: number;
      shift_score: number;
    };
    entity_type_classifier?: {
      entity_type: string;
    };
    alert_prioritizer?: {
      priority_score: number;
    };
  };
  explainability?: {
    decision: "flagged" | "monitor" | "low_risk";
    summary: string;
    reasons: string[];
  };
}

export interface MlBatchPredictionResponse {
  count: number;
  results: MlAllFeaturesResponse[];
  errors: Array<{ wallet_address: string; error: string }>;
}

export interface MlTrainMetrics {
  model_path: string;
  dataset_path: string;
  rows: number;
  features: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number | null;
}

export interface MlTrainResponse {
  message: string;
  metrics: MlTrainMetrics;
}

function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!configured) {
    throw new Error("Missing VITE_API_BASE_URL. Set it in your frontend environment variables.");
  }
  return configured.replace(/\/$/, "");
}

function buildErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (status === 400) return "Please provide a valid Ethereum wallet address.";
  if (status === 500) return "Backend configuration error. Check ETHERSCAN_API_KEY.";
  if (status >= 500) return "The analysis service is temporarily unavailable.";
  return "Unable to analyze this wallet right now.";
}

export async function analyzeWallet(walletAddress: string): Promise<WalletAnalysisResponse> {
  const response = await fetch(`${getApiBaseUrl()}/analyze_wallet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wallet_address: walletAddress }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  return payload as WalletAnalysisResponse;
}

export async function getMlModelStatus(): Promise<MlStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/ml/status`);
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  return payload as MlStatusResponse;
}

export async function trainMlModel(options?: {
  test_size?: number;
  random_state?: number;
  dataset_path?: string;
  model_path?: string;
}): Promise<MlTrainResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/ml/train`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options ?? {}),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  return payload as MlTrainResponse;
}

export async function predictWalletRisk(walletAddress: string): Promise<MlPredictionResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/ml/predict`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wallet_address: walletAddress }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  return payload as MlPredictionResponse;
}

export async function predictAllAiFeatures(walletAddress: string): Promise<MlAllFeaturesResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/ml/predict-all`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wallet_address: walletAddress }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  return payload as MlAllFeaturesResponse;
}

export async function predictAllAiFeaturesBatch(walletAddresses: string[]): Promise<MlBatchPredictionResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/ml/predict-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wallet_addresses: walletAddresses }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  return payload as MlBatchPredictionResponse;
}