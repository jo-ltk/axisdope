'use client';

import { useEffect, useRef } from 'react';
import { experienceConfig as cfg } from '@/lib/experience/config';
import { mountExperience } from '@/lib/experience/engine';

/**
 * The page is one fixed WebGL stage. The scroll sections below it are only a timeline:
 * their height decides how long each scene lasts. Everything visible is drawn by the engine.
 */
export default function Experience() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return mountExperience(root.current, cfg);
  }, []);

  return (
    <div ref={root}>
      <canvas data-el="stage" className="stage" aria-hidden="true" />

      <div data-el="hud" className="hud">
        <div className="tl"><b>{cfg.name}</b><span>Present tense</span></div>
        <div className="tr"><span>{cfg.city}</span><span data-el="time">--:--:--</span><span>{cfg.temperatureC}°C</span></div>
        <div className="bl"><span>{cfg.coords[0]}</span><span>{cfg.coords[1]}</span></div>
        <div className="br">
          <span data-el="scene">01 / 06 {cfg.displayName}</span>
          <div className="meter"><i data-el="meter" /></div>
          <button data-el="smear" type="button" className="smear" aria-pressed="true">Smear on</button>
        </div>
        <div data-el="hint" className="hint">Move. The present follows your cursor.</div>
      </div>

      <div data-el="cursor" className="cursor" aria-hidden="true"><i /><span data-el="cursorLabel">NOW</span></div>
      <button data-el="mail" type="button" className="mail" aria-label={`Copy the email address ${cfg.email}`}>{cfg.email}</button>
      <button data-el="again" type="button" className="again">Expose again</button>
      <div data-el="toast" className="toast" role="status" aria-live="polite" />

      <main className="track">
        <section data-sec className="sec" style={{ height: '160vh' }}>
          <h1 className="sr">{cfg.displayName}</h1>
          <p className="sr">Currently in {cfg.city}.</p>
        </section>
        <section data-sec className="sec" style={{ height: '320vh' }}>
          <p className="sr">Your local time: <span data-el="srTime" /></p>
        </section>
        <section data-sec className="sec" style={{ height: '320vh' }}>
          <p className="sr">Six placeholder images, generated in the browser.</p>
        </section>
        <section data-sec className="sec" style={{ height: '320vh' }}>
          <p className="sr">A photo-finish recording of the name {cfg.displayName}, drawn as you scroll.</p>
        </section>
        <section data-sec className="sec" style={{ height: '180vh' }}>
          <p className="sr">Air temperature in {cfg.city}: {cfg.temperatureC}°C.</p>
        </section>
        <section data-sec className="sec" style={{ height: '140vh' }}>
          <p className="sr">Email: {cfg.email}</p>
          <p className="sr">{cfg.handle}. {cfg.note}.</p>
        </section>
      </main>
    </div>
  );
}
