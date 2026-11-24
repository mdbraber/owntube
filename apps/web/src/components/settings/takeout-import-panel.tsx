"use client";

import { useState } from "react";
import { SettingRow } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

export function TakeoutImportPanel() {
  const [payloadJson, setPayloadJson] = useState("");
  const [payloadSubscriptionsCsv, setPayloadSubscriptionsCsv] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [replaceSubscriptions, setReplaceSubscriptions] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const historyMutation = trpc.takeout.importHistory.useMutation({
    onSuccess: async (res) => {
      setMessage(`Imported ${res.imported} history entries.`);
      await utils.history.invalidate();
      await utils.stats.invalidate();
    },
    onError: (e) => {
      setMessage(`Import failed: ${e.message}`);
    },
  });
  const subscriptionsMutation = trpc.takeout.importSubscriptions.useMutation({
    onSuccess: async (res) => {
      setMessage(`Imported ${res.imported} subscriptions.`);
      await utils.subscriptions.invalidate();
      await utils.feed.invalidate();
    },
    onError: (e) => {
      setMessage(`Import failed: ${e.message}`);
    },
  });

  async function onPickHistoryFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      setPayloadJson(text);
      setMessage(`Loaded ${file.name}`);
    } catch {
      setMessage("Could not read file.");
    }
  }
  async function onPickSubscriptionsFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      setPayloadSubscriptionsCsv(text);
      setMessage(`Loaded ${file.name}`);
    } catch {
      setMessage("Could not read file.");
    }
  }

  const fieldClass =
    "w-full rounded-[var(--radius-shell)] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 font-mono text-xs";
  const fileClass =
    "block w-full text-xs file:mr-3 file:rounded-[var(--radius-shell)] file:border file:border-[hsl(var(--border))] file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[hsl(var(--foreground))]";

  return (
    <>
      <SettingRow
        stack
        title="Import YouTube watch history"
        description="From Google Takeout: load watch-history.html or .json, or paste the JSON."
      >
        <div className="space-y-2">
          <input
            aria-label="Watch history file"
            type="file"
            accept="application/json,text/html,.json,.html"
            onChange={(e) =>
              void onPickHistoryFile(e.currentTarget.files?.[0] ?? null)
            }
            className={fileClass}
          />
          <textarea
            value={payloadJson}
            onChange={(e) => setPayloadJson(e.currentTarget.value)}
            className={`min-h-20 ${fieldClass}`}
            placeholder='[{"titleUrl":"https://www.youtube.com/watch?v=…", …}]'
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={!payloadJson.trim() || historyMutation.isPending}
              onClick={() =>
                historyMutation.mutate({ payloadJson, replaceExisting })
              }
            >
              Import history
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.currentTarget.checked)}
              />
              Replace existing first
            </label>
          </div>
        </div>
      </SettingRow>
      <SettingRow
        stack
        title="Import YouTube subscriptions"
        description="From Google Takeout: load subscriptions.csv, or paste it."
      >
        <div className="space-y-2">
          <input
            aria-label="Subscriptions file"
            type="file"
            accept="text/csv,.csv"
            onChange={(e) =>
              void onPickSubscriptionsFile(e.currentTarget.files?.[0] ?? null)
            }
            className={fileClass}
          />
          <textarea
            value={payloadSubscriptionsCsv}
            onChange={(e) => setPayloadSubscriptionsCsv(e.currentTarget.value)}
            className={`min-h-16 ${fieldClass}`}
            placeholder="Channel ID,Channel URL,Channel title"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={
                !payloadSubscriptionsCsv.trim() ||
                subscriptionsMutation.isPending
              }
              onClick={() =>
                subscriptionsMutation.mutate({
                  payloadCsv: payloadSubscriptionsCsv,
                  replaceExisting: replaceSubscriptions,
                })
              }
            >
              Import subscriptions
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replaceSubscriptions}
                onChange={(e) =>
                  setReplaceSubscriptions(e.currentTarget.checked)
                }
              />
              Replace existing first
            </label>
          </div>
          {message ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {message}
            </p>
          ) : null}
        </div>
      </SettingRow>
    </>
  );
}
