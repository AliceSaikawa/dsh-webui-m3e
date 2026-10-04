import type { SettingObject } from '../../web/src/features/settings/schema.ts'

export interface SettingWriteCase { id: string; ns: string; patch: SettingObject; ok: boolean }

/** The auditor's 31 inputs, with outcomes independently verified against DSH. */
export const settingsWriteCases: SettingWriteCase[] = [
  { id: 'W32', ns: 'agent-loop', patch: { maxParallelToolCalls: 1.000000001 }, ok: false },
  {
    "id": "W01",
    "ns": "agent-default-model",
    "patch": {
      "model": "audit-model"
    },
    "ok": true
  },
  {
    "id": "W02",
    "ns": "agent-default-model",
    "patch": {
      "timeout": 60
    },
    "ok": false
  },
  {
    "id": "W03",
    "ns": "subagent-model-selection-settings",
    "patch": {
      "allowedModels": [
        {
          "provider": "deepseek-official",
          "model": "deepseek-flash"
        }
      ]
    },
    "ok": true
  },
  {
    "id": "W04",
    "ns": "subagent-model-selection-settings",
    "patch": {
      "allowedModels": [
        {}
      ]
    },
    "ok": false
  },
  {
    "id": "W05",
    "ns": "subagent-model-selection-settings",
    "patch": {
      "enabled": true,
      "allowedModels": []
    },
    "ok": true
  },
  {
    "id": "W06",
    "ns": "subagent-model-selection-settings",
    "patch": {
      "allowedModels": [
        {
          "provider": "p",
          "model": "m"
        },
        {
          "provider": "p",
          "model": "m"
        }
      ]
    },
    "ok": true
  },
  {
    "id": "W07",
    "ns": "permission",
    "patch": {
      "defaultPreset": "read-only"
    },
    "ok": true
  },
  {
    "id": "W08",
    "ns": "permission",
    "patch": {
      "timeout": 60
    },
    "ok": false
  },
  {
    "id": "W09",
    "ns": "permission",
    "patch": {
      "defaultPreset": "unknown-audit-preset"
    },
    "ok": true
  },
  {
    "id": "W10",
    "ns": "agent-preset-registry",
    "patch": {
      "selectedDefault": "default"
    },
    "ok": true
  },
  {
    "id": "W11",
    "ns": "agent-preset-registry",
    "patch": {
      "default": "x"
    },
    "ok": false
  },
  {
    "id": "W12",
    "ns": "agent-loop",
    "patch": {
      "maxParallelToolCalls": 2
    },
    "ok": true
  },
  {
    "id": "W13",
    "ns": "agent-loop",
    "patch": {
      "maxParallelToolCalls": 1.5
    },
    "ok": false
  },
  {
    "id": "W14",
    "ns": "bash-sandbox",
    "patch": {
      "timeoutMs": 61000
    },
    "ok": true
  },
  {
    "id": "W15",
    "ns": "bash-sandbox",
    "patch": {
      "timeout": 60
    },
    "ok": false
  },
  {
    "id": "W16",
    "ns": "bash-sandbox",
    "patch": {
      "timeoutMs": -1
    },
    "ok": true
  },
  {
    "id": "W17",
    "ns": "web-search-deepseek",
    "patch": {
      "maxUses": 6
    },
    "ok": true
  },
  {
    "id": "W18",
    "ns": "web-search-deepseek",
    "patch": {
      "maxUses": 0
    },
    "ok": false
  },
  {
    "id": "W19",
    "ns": "llm-deepseek",
    "patch": {
      "thinking": "enabled"
    },
    "ok": true
  },
  {
    "id": "W20",
    "ns": "llm-deepseek",
    "patch": {
      "thinking": "unsupported"
    },
    "ok": false
  },
  {
    "id": "W21",
    "ns": "llm-deepseek",
    "patch": {
      "retryPolicy": {
        "mode": "normal",
        "maxRetries": 2
      }
    },
    "ok": true
  },
  {
    "id": "W22",
    "ns": "llm-deepseek",
    "patch": {
      "retryPolicy": {
        "maxRetries": 2
      }
    },
    "ok": false
  },
  {
    "id": "W23",
    "ns": "llm-deepseek",
    "patch": {
      "models": [
        {
          "id": "audit",
          "extraField": true
        }
      ]
    },
    "ok": true
  },
  {
    "id": "W24",
    "ns": "llm-pi-ai",
    "patch": {
      "providers": {
        "openai": {
          "displayName": "Audit"
        }
      }
    },
    "ok": true
  },
  {
    "id": "W25",
    "ns": "llm-pi-ai",
    "patch": {
      "providers": {
        "openai": {
          "displayName": ""
        }
      }
    },
    "ok": false
  },
  {
    "id": "W26",
    "ns": "llm-pi-ai",
    "patch": {
      "providers": {
        "openai": {
          "defaultInput": []
        }
      }
    },
    "ok": false
  },
  {
    "id": "W27",
    "ns": "llm-pi-ai",
    "patch": {
      "providers": {
        "openai": {
          "unknown": true
        }
      }
    },
    "ok": true
  },
  {
    "id": "W28",
    "ns": "locale",
    "patch": {
      "preference": "ja-JP"
    },
    "ok": true
  },
  {
    "id": "W29",
    "ns": "locale",
    "patch": {
      "preference": "not a locale"
    },
    "ok": false
  },
  {
    "id": "W30",
    "ns": "ui-theme",
    "patch": {
      "fontSize": 16
    },
    "ok": true
  },
  {
    "id": "W31",
    "ns": "ui-theme",
    "patch": {
      "fontSize": 9
    },
    "ok": false
  }
]

export const dictionaryKeyCases: SettingWriteCase[] = [
  { id: 'K01', ns: 'llm-pi-ai', patch: { providers: { openai: { models: [{ id: 'audit-model', reasoningEfforts: { high: 'high' } }] } } }, ok: true },
  { id: 'K02', ns: 'llm-pi-ai', patch: { providers: { openai: { models: [{ id: 'audit-model', reasoningEfforts: { not_an_effort: 'high' } }] } } }, ok: false },
]
