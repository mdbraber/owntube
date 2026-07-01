"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

export function TakeoutImportPanel() {
  const [payloadJson, setPayloadJson] = useState("");
  const [payloadSubscriptionsCsv, setPayloadSubscriptionsCsv] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
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

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        Import YouTube Takeout watch history
      </h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Paste the JSON array from Takeout watch-history, or load
        watch-history.html / watch-history.json directly.
      </p>
      <label className="block text-sm font-medium" htmlFor="takeout-file">
        Load JSON file
      </label>
      <input
        id="takeout-file"
        type="file"
        accept="application/json,text/html,.json,.html"
        onChange={(e) =>
          void onPickHistoryFile(e.currentTarget.files?.[0] ?? null)
        }
        className="block w-full text-sm"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(e) => setReplaceExisting(e.currentTarget.checked)}
        />
        Replace existing history before import
      </label>
      <textarea
        value={payloadJson}
        onChange={(e) => setPayloadJson(e.currentTarget.value)}
        className="min-h-40 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm"
        placeholder='[{"titleUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ", ...}]'
      />
      <Button
        type="button"
        disabled={!payloadJson.trim() || historyMutation.isPending}
        onClick={() => historyMutation.mutate({ payloadJson, replaceExisting })}
      >
        Import history
      </Button>

      <div className="my-2 h-px w-full bg-[hsl(var(--border))]" />

      <h2 className="text-lg font-semibold">
        Import YouTube Takeout subscriptions
      </h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Load the <code>subscriptions.csv</code> file from your Takeout export.
      </p>
      <label
        className="block text-sm font-medium"
        htmlFor="takeout-subscriptions-file"
      >
        Load subscriptions CSV
      </label>
      <input
        id="takeout-subscriptions-file"
        type="file"
        accept="text/csv,.csv"
        onChange={(e) =>
          void onPickSubscriptionsFile(e.currentTarget.files?.[0] ?? null)
        }
        className="block w-full text-sm"
      />
      <textarea
        value={payloadSubscriptionsCsv}
        onChange={(e) => setPayloadSubscriptionsCsv(e.currentTarget.value)}
        className="min-h-32 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm"
        placeholder="Channel ID,Channel URL,Channel title"
      />
      <Button
        type="button"
        disabled={
          !payloadSubscriptionsCsv.trim() || subscriptionsMutation.isPending
        }
        onClick={() =>
          subscriptionsMutation.mutate({
            payloadCsv: payloadSubscriptionsCsv,
            replaceExisting,
          })
        }
      >
        Import subscriptions
      </Button>
      {message ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
      ) : null}
    </section>
  );
}
