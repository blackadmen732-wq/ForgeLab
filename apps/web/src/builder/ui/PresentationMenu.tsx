import { Check, Clapperboard, Maximize, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  QUALITY_TIERS,
  updateSettings,
  useSettings,
  type PresentationSettings,
} from "../../presentation/settings.js";
import { toggleCinematic, toggleFullscreen } from "../../presentation/view.js";

/**
 * Local presentation options: how the hall is drawn and how loud it is. These belong to
 * this viewer on this device and change nothing about the simulation.
 */
export function PresentationMenu() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = (key: keyof PresentationSettings, label: string, hint?: string) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={settings[key] === true}
      className="menu__item"
      title={hint}
      onClick={() => updateSettings({ [key]: !settings[key] })}
    >
      {settings[key] === true ? <Check /> : <span className="menu__pad" />} {label}
    </button>
  );
  const slider = (
    key: "masterVolume" | "alarmVolume" | "ambientVolume" | "cameraEffectsIntensity",
    label: string,
  ) => (
    <label className="menu__slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={settings[key]}
        onChange={(e) => updateSettings({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-label={settings.muted ? "Sound off" : "Sound on"}
        data-tip={settings.muted ? "Sound off (click to unmute)" : "Mute sound"}
        onClick={() => updateSettings({ muted: !settings.muted })}
      >
        {settings.muted ? <VolumeX /> : <Volume2 />}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-label="Presentation settings"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="Graphics, motion and sound"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal />
      </button>
      {open && (
        <div className="menu__list" role="menu">
          <div className="menu__label">Graphics quality</div>
          {QUALITY_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              role="menuitemradio"
              aria-checked={settings.quality === tier}
              className="menu__item"
              onClick={() => updateSettings({ quality: tier })}
            >
              {settings.quality === tier ? <Check /> : <span className="menu__pad" />}{" "}
              {tier[0] + tier.slice(1).toLowerCase()}
            </button>
          ))}
          <p className="menu__note">Drawing only — the simulation is identical at every level.</p>
          <div className="menu__sep" />
          {toggle("haze", "Hall haze")}
          {toggle("bloom", "Glow on bright lights")}
          {toggle("screenCrack", "Camera-glass cracks from debris")}
          {toggle("reducedEffects", "Reduce flashes and blinking")}
          {toggle("reduceMotion", "Reduce motion (no shake or drift)")}
          {slider("cameraEffectsIntensity", "Camera shake")}
          {toggle("autoCutaway", "Open the cutaway on the failed part")}
          <div className="menu__sep" />
          <div className="menu__label">Sound</div>
          {slider("masterVolume", "Master")}
          {slider("alarmVolume", "Alarms")}
          {slider("ambientVolume", "Hall ambience")}
          <div className="menu__sep" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              toggleCinematic();
            }}
          >
            <Clapperboard /> Cinematic view <span className="menu__hint">K</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              toggleFullscreen();
            }}
          >
            <Maximize /> Fullscreen <span className="menu__hint">⇧ K</span>
          </button>
        </div>
      )}
    </div>
  );
}
