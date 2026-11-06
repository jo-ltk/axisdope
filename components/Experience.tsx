'use client';

import { useEffect, useRef } from 'react';
import { experienceConfig as cfg } from '@/lib/experience/config';
import { mountExperience } from '@/lib/experience/engine';
import { createProducts } from '@/lib/experience/products';

const PIECES = createProducts().map(p => ({ code: p.code, name: p.name }));

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

      {/* the opening page: Alex's original black page, which then glides into the top bar */}
      <div data-el="intro" className="intro" aria-hidden="true">
        <div data-el="introBg" className="intro-bg" />
        <div className="intro-stack">
          <span data-intro="name">{cfg.displayName}</span>
          <span data-intro="city">currently in {cfg.city}</span>
          <span data-intro="time">--:--:--</span>
          <span data-intro="temp">{cfg.temperatureC}°C</span>
          <span data-intro="email" className="dim gap">{cfg.email}</span>
          <span data-intro="aside" className="dim">{cfg.aside}</span>
        </div>
      </div>

      <div data-el="hud" className="hud">
        <div className="top">
          <b data-hud="name">{cfg.name}</b>
          <span data-hud="city"><span className="cur-in">Currently in </span>{cfg.city}</span>
          <span data-hud="time" data-el="time">--:--:--</span>
          <span data-hud="temp">{cfg.temperatureC}°C</span>
        </div>
        <div className="bl"><span data-hud="aside">{cfg.aside}</span></div>
        <div className="br" data-hud-rest>
          <span data-el="scene">01 / 06 Index</span>
          <div className="meter"><i data-el="meter" /></div>
          <button data-el="smear" type="button" className="smear" aria-pressed="true">Smear on</button>
        </div>
        <div data-el="hint" className="hint" data-hud-rest>Select an object to hold it. Scroll to go on.</div>
      </div>

      <div data-el="cursor" className="cursor" aria-hidden="true"><i /><span data-el="cursorLabel">NOW</span></div>
      <button data-el="mail" type="button" className="mail" aria-label={`Copy the email address ${cfg.email}`}>{cfg.email}</button>
      <button data-el="again" type="button" className="again">Expose again</button>
      <div data-el="toast" className="toast" role="status" aria-live="polite" />

      {/* piece page: opened from the index grid, or directly with #piece-001 … #piece-012 */}
      <div data-el="piece" className="piece" role="dialog" aria-modal="true" aria-labelledby="piece-title" tabIndex={-1} hidden>
        <button data-el="pieceClose" type="button" className="piece-close">← Index</button>
        <div className="piece-inner">
          <div className="piece-media">
            <canvas data-el="pieceCanvas" aria-label="The object in 3D. Drag to turn it, tap to make it spin." />
            <p className="piece-hint">Drag to turn · Tap to play</p>
          </div>
          <div className="piece-info">
            <p className="piece-code" data-el="pieceCode">001</p>
            <h2 className="piece-name" id="piece-title" data-el="pieceName">Sphere</h2>
            <p className="piece-note">A study in form.</p>
            <dl className="piece-specs">
              <div><dt>Form</dt><dd data-el="pieceForm">Sphere</dd></div>
              <div><dt>Finish</dt><dd>Matte black</dd></div>
              <div><dt>Status</dt><dd>Forthcoming</dd></div>
            </dl>
            <button data-el="pieceEnquire" type="button" className="piece-enquire">Enquire</button>
            <p className="piece-mail">{cfg.email}</p>
            <div className="piece-nav">
              <button data-el="piecePrev" type="button">Previous</button>
              <span data-el="pieceIndex">01 / 12</span>
              <button data-el="pieceNext" type="button">Next</button>
            </div>
          </div>
        </div>
      </div>

      <main className="track">
        <section data-sec className="sec" style={{ height: '100vh' }}>
          <h1 className="sr">{cfg.displayName}</h1>
          <h2 className="sr">Index of forms</h2>
          <ul className="sr">
            {PIECES.map((p, i) => (
              <li key={p.code}><button type="button" data-piece={i}>View {p.code} {p.name.toLowerCase()}</button></li>
            ))}
          </ul>
        </section>
        <section data-sec className="sec" style={{ height: '160vh' }}>
          <p className="sr">Currently in {cfg.city}.</p>
        </section>
        <section data-sec className="sec" style={{ height: '320vh' }}>
          <p className="sr">Your local time: <span data-el="srTime" /></p>
        </section>
        <section data-sec className="sec" style={{ height: '320vh' }}>
          <p className="sr">Six placeholder images, generated in the browser.</p>
        </section>
        <section data-sec className="sec" style={{ height: '180vh' }}>
          <p className="sr">Air temperature in {cfg.city}: {cfg.temperatureC}°C.</p>
        </section>
        <section data-sec className="sec" style={{ height: '140vh' }}>
          <p className="sr">Email: {cfg.email}</p>
        </section>
      </main>
    </div>
  );
}
