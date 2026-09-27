import { useEffect, useState } from "react";
import { Copy, Check, X, TriangleAlert } from "lucide-react";
import { Alert, HAZARD_LABEL, capXml, sms } from "../model/derive";
import { toLngLat } from "../model/grid";
import { Segmented } from "./ui";

type Lang = "en" | "hi" | "te";

export default function CapModal({ alert, view, onView, onClose }: {
  alert: Alert;
  view: "cap" | "sms";
  onView: (v: "cap" | "sms") => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const xml = capXml(alert, toLngLat(alert.site.x, alert.site.y));
  const text = sms(alert);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const copy = async () => {
    await navigator.clipboard.writeText(view === "cap" ? xml : text[lang]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Alert output" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{HAZARD_LABEL[alert.hazard]} — {alert.site.name}</div>
            <div className="muted">Dissemination output · status “Exercise” while the scenario is synthetic</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-bar">
          <Segmented<"cap" | "sms"> label="Output" value={view} onChange={onView}
            options={[{ value: "cap", label: "CAP 1.2 XML" }, { value: "sms", label: "SMS" }]} />
          {view === "sms" && (
            <Segmented<Lang> size="sm" label="Language" value={lang} onChange={setLang}
              options={[{ value: "en", label: "English" }, { value: "hi", label: "हिन्दी" }, { value: "te", label: "తెలుగు" }]} />
          )}
          <button className="btn" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
        </div>

        {view === "cap" ? (
          <pre className="code" aria-label="CAP XML">{xml}</pre>
        ) : (
          <div className="sms-wrap">
            <div className="phone">
              <div className="phone-sender">NOWCAST</div>
              <div className={`bubble lang-${lang}`} lang={lang}>{text[lang]}</div>
              <div className="phone-meta">{text[lang].length} characters{lang !== "en" ? " · Unicode SMS" : ""}</div>
            </div>
            {lang !== "en" && (
              <div className="warn-box">
                <TriangleAlert size={16} />
                <span>Machine-drafted {lang === "hi" ? "Hindi" : "Telugu"}. A native speaker must review wording before any real use.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
