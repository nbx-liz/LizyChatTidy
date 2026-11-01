import { useEffect, useId, useRef, useState } from "react";
import { MIN_PASSPHRASE_LENGTH } from "../../keep/crypto";
import type { KeepState, KeepStore, UnavailableReason } from "../../keep/keepStore";

type Mode = "idle" | "create" | "unlock" | "delete";

const STATUS_LABELS: Readonly<Record<KeepState["status"], string>> = {
  loading: "確認中",
  absent: "未作成",
  locked: "ロック中",
  available: "解除済み",
  corrupt: "破損",
  unavailable: "利用不可",
};

const REASON_TEXT: Readonly<Record<UnavailableReason, string>> = {
  "access-level":
    "保存領域へのアクセスを拡張の内部に限定できませんでした。KEEP の保存と対象タブへの接続を止めています。",
  "read-failed": "保存データを読み取れませんでした。",
  "write-failed": "保存データを書き込めませんでした（容量不足などの可能性があります）。",
  "delete-failed": "保存データを削除できませんでした。",
  "crypto-failed": "暗号処理に失敗しました。",
  "lock-unavailable": "このブラウザーでは複数タブの書き込みを順序付けできません。",
  "lock-timeout": "別のタブが保存中のため、待ちきれませんでした。",
  conflict: "別のタブが保存データを変更しました。",
  "changed-elsewhere": "別のタブ（または別の操作）が保存データを変更しました。",
  regressed: "保存データがこの画面で確認したものより古くなっています（巻き戻しの可能性）。",
  replaced: "保存データがこの画面で確認したものと別のものに置き換わっています。",
};

function describe(state: KeepState): string {
  switch (state.status) {
    case "loading":
      return "KEEP の保存先を確認しています…";
    case "absent":
      return "KEEP の保存先がありません（消去された場合も同じ表示になります）。KEEP を付けるには、暗号化した保存先を作成してください。";
    case "locked":
      return "保存先はロックされています。パスフレーズで解除すると KEEP を付けられます。";
    case "available":
      return "保存先は解除済みです。";
    case "corrupt":
      return "保存データが壊れているか、対応していない形式です。KEEP は使えません。続けるには保存データを削除して作り直してください（KEEP の内容は失われます）。";
    case "unavailable":
      return `${REASON_TEXT[state.reason]} KEEP を確認できないため、KEEP の付け外しを止めています。`;
  }
}

export function KeepPanel({
  store,
  state,
}: {
  readonly store: KeepStore;
  readonly state: KeepState;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteToken, setDeleteToken] = useState<string | null>(null);
  const ids = {
    heading: useId(),
    form: useId(),
    err: useId(),
    pass: useId(),
    confirm: useId(),
    consent: useId(),
  };
  const formHeading = useRef<HTMLHeadingElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Leaving a form whenever the store's state changes keeps the panel honest.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the status changes
  useEffect(() => {
    setMode("idle");
    setError(null);
  }, [state.status]);

  useEffect(() => {
    if (mode === "create") {
      formHeading.current?.focus();
    } else if (mode === "unlock") {
      firstInput.current?.focus();
    } else if (mode === "delete") {
      cancelRef.current?.focus();
    }
  }, [mode]);

  const run = async (op: () => Promise<string>, messages: Record<string, string>) => {
    setBusy(true);
    setError(null);
    const result = await op();
    setBusy(false);
    if (result === "ok") {
      setMode("idle");
      setNotice(messages["ok"] ?? null);
    } else {
      setError(messages[result] ?? "操作を完了できませんでした。状態の表示を確認してください。");
    }
  };

  const status = state.status;
  return (
    <section className="keep-panel" aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>KEEP の保存先</h2>
      <p role="status" className="note">
        <strong>{STATUS_LABELS[status]}</strong>：{describe(state)}
        {notice !== null && ` ${notice}`}
      </p>
      {mode === "idle" && (
        <div className="keep-actions">
          {status === "absent" && (
            <button type="button" onClick={() => setMode("create")}>
              保存先を作成…
            </button>
          )}
          {status === "locked" && (
            <button type="button" onClick={() => setMode("unlock")}>
              解除…
            </button>
          )}
          {status === "available" && (
            <button
              type="button"
              onClick={() => void run(() => store.lock(), { ok: "ロックしました。" })}
            >
              ロック
            </button>
          )}
          {status === "unavailable" && state.reason !== "access-level" && (
            <button type="button" onClick={() => void run(() => store.reload(), {})}>
              再読み込み
            </button>
          )}
          {status === "unavailable" &&
            (state.reason === "regressed" || state.reason === "replaced") && (
              <button type="button" onClick={() => void run(() => store.adopt(), {})}>
                この保存データを使う
              </button>
            )}
          {(status === "available" ||
            status === "locked" ||
            status === "corrupt" ||
            status === "unavailable") &&
            !(status === "unavailable" && state.reason === "access-level") && (
              <button
                type="button"
                onClick={() => {
                  setDeleteToken(store.observedToken());
                  setMode("delete");
                }}
              >
                保存データを削除…
              </button>
            )}
        </div>
      )}
      {mode === "create" && (
        <CreateForm
          ids={ids}
          headingRef={formHeading}
          busy={busy}
          error={error}
          onCancel={() => setMode("idle")}
          onSubmit={(pass, confirm, consent) => {
            if (pass !== confirm) {
              setError("確認用と一致しません。");
              return;
            }
            void run(() => store.create(pass, consent), {
              ok: "保存先を作成しました。",
              "no-consent": "同意にチェックを入れてください。",
              "short-passphrase": `${MIN_PASSPHRASE_LENGTH} 文字以上で入力してください。`,
            });
          }}
        />
      )}
      {mode === "unlock" && (
        <form
          aria-labelledby={ids.form}
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("passphrase") as HTMLInputElement;
            const pass = input.value;
            input.value = "";
            void run(() => store.unlock(pass), {
              ok: "解除しました。",
              "wrong-passphrase": "パスフレーズが違うか、保存データが壊れています。",
            });
          }}
        >
          <h3 id={ids.form}>保存先を解除</h3>
          <label htmlFor={ids.pass}>パスフレーズ</label>
          <input
            ref={firstInput}
            id={ids.pass}
            name="passphrase"
            type="password"
            autoComplete="current-password"
            aria-describedby={error === null ? undefined : ids.err}
            aria-invalid={error !== null}
          />
          {error !== null && (
            <p id={ids.err} className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            解除
          </button>
          <button type="button" onClick={() => setMode("idle")}>
            キャンセル
          </button>
        </form>
      )}
      {mode === "delete" && (
        <DeleteConfirm
          cancelRef={cancelRef}
          busy={busy}
          error={error}
          onCancel={() => setMode("idle")}
          onConfirm={() =>
            void run(() => store.deleteStore(deleteToken), {
              ok: "KEEP の保存先を削除しました。",
              changed:
                "確認の後に保存データが変わりました。状態を確認して、もう一度やり直してください。",
            })
          }
        />
      )}
    </section>
  );
}

function CreateForm({
  ids,
  headingRef,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  ids: { form: string; err: string; pass: string; confirm: string; consent: string };
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (pass: string, confirm: string, consent: boolean) => void;
}) {
  return (
    <form
      aria-labelledby={ids.form}
      onSubmit={(event) => {
        event.preventDefault();
        const f = event.currentTarget.elements;
        const pass = f.namedItem("passphrase") as HTMLInputElement;
        const confirm = f.namedItem("confirm") as HTMLInputElement;
        const consent = f.namedItem("consent") as HTMLInputElement;
        onSubmit(pass.value, confirm.value, consent.checked);
        pass.value = "";
        confirm.value = "";
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <h3 id={ids.form} ref={headingRef} tabIndex={-1}>
        保存先を作成
      </h3>
      <p className="note">
        保存するのは、サービス名・会話
        ID・範囲（scope）だけです。暗号化してこの端末のブラウザー内に保存します。タイトルと本文は保存しません。パスフレーズは復元できません。忘れると
        KEEP の内容は失われます。
      </p>
      <label className="check">
        <input id={ids.consent} name="consent" type="checkbox" />
        上記を理解し、保存先の作成に同意します
      </label>
      <label htmlFor={ids.pass}>パスフレーズ（{MIN_PASSPHRASE_LENGTH} 文字以上）</label>
      <input
        id={ids.pass}
        name="passphrase"
        type="password"
        autoComplete="new-password"
        aria-describedby={error === null ? undefined : ids.err}
        aria-invalid={error !== null}
      />
      <label htmlFor={ids.confirm}>パスフレーズ（確認）</label>
      <input id={ids.confirm} name="confirm" type="password" autoComplete="new-password" />
      {error !== null && (
        <p id={ids.err} className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        作成
      </button>
      <button type="button" onClick={onCancel}>
        キャンセル
      </button>
    </form>
  );
}

function DeleteConfirm({
  cancelRef,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  return (
    <fieldset className="keep-delete">
      <legend>保存データの削除の確認</legend>
      <p>保存した KEEP をすべて消します。元に戻せません。</p>
      <label className="check">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.currentTarget.checked)}
        />
        KEEP の内容が失われることを理解しました
      </label>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button ref={cancelRef} type="button" onClick={onCancel}>
        やめる
      </button>
      {/* Never the initial focus and inert until the box is ticked, so repeated Enter cannot confirm (AT33). */}
      <button
        type="button"
        className="danger"
        aria-disabled={!understood || busy}
        onClick={() => {
          if (understood && !busy) {
            onConfirm();
          }
        }}
      >
        削除する
      </button>
    </fieldset>
  );
}
