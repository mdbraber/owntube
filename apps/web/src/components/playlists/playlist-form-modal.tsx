"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/components/videos/action-toast";
import { trpc } from "@/trpc/react";

type PlaylistFormModalProps = {
  open: boolean;
  onClose: () => void;
  /** Editing an existing playlist; omit for create. */
  playlist?: { id: number; name: string; description: string | null };
};

/**
 * Create / edit playlist modal (name + description), with delete on edit.
 * Same dialog conventions as the share modal: portal, backdrop, Escape,
 * bottom-sheet on phones.
 */
export function PlaylistFormModal({
  open,
  onClose,
  playlist,
}: PlaylistFormModalProps) {
  const titleId = useId();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { showToast } = useActionToast();

  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");

  // Re-seed when (re)opened for a possibly different playlist.
  useEffect(() => {
    if (!open) return;
    setName(playlist?.name ?? "");
    setDescription(playlist?.description ?? "");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, playlist, onClose]);

  const invalidate = () =>
    Promise.all([
      utils.playlists.list.invalidate(),
      utils.playlists.detail.invalidate(),
      utils.playlists.membership.invalidate(),
    ]);

  const create = trpc.playlists.create.useMutation({
    onSuccess: async (created) => {
      await invalidate();
      showToast("Playlist created");
      onClose();
      router.push(`/playlists/${created.id}`);
    },
  });
  const rename = trpc.playlists.rename.useMutation({
    onSuccess: async () => {
      await invalidate();
      showToast("Playlist updated");
      onClose();
    },
  });
  const removePlaylist = trpc.playlists.remove.useMutation({
    onSuccess: async () => {
      await invalidate();
      showToast("Playlist deleted");
      onClose();
      router.push("/playlists");
    },
  });

  if (!open) return null;

  const pending =
    create.isPending || rename.isPending || removePlaylist.isPending;
  const canSubmit = name.trim().length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    if (playlist) {
      rename.mutate({
        playlistId: playlist.id,
        name,
        description: description.trim() || undefined,
      });
    } else {
      create.mutate({ name, description: description.trim() || undefined });
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/45 animate-[ot-fade-in_180ms_ease-out] motion-reduce:animate-none"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full rounded-t-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl animate-[ot-sheet-in_220ms_cubic-bezier(0.32,0.72,0.22,1)] motion-reduce:animate-none sm:max-w-md sm:rounded-2xl sm:pb-4 sm:animate-[ot-fade-in_180ms_ease-out]"
      >
        <h2 id={titleId} className="m-0 text-base font-semibold">
          {playlist ? "Edit playlist" : "New playlist"}
        </h2>

        <div className="mt-3 space-y-2.5">
          <Input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Playlist name"
            maxLength={120}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="Description (optional)"
            maxLength={2000}
            rows={3}
            className="w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.4)] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus-visible:border-[hsl(var(--primary)_/_0.5)]"
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          {playlist ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)_/_0.1)] disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete playlist "${playlist.name}"?`)) {
                  removePlaylist.mutate({ playlistId: playlist.id });
                }
              }}
            >
              Delete playlist
            </button>
          ) : null}
          <span className="ml-auto" />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
          >
            {playlist ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
