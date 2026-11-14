// Monochrome line icons (inline SVG) used instead of emoji, so they look
// the same on every device and take the colour of the surrounding text.

const S = (d) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  fist: S('<path d="M5.5 11a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5v4a5.5 5.5 0 0 1-5.5 5.5h-3A5.5 5.5 0 0 1 5.5 15z"/><path d="M10 8.5v3.5M13.2 8.5v3.5M16.4 8.5v3.5M5.5 13.2h3.8a1.6 1.6 0 0 0 0-3.2"/>'),
  hand: S('<path d="M8.2 12.6V5.6a1.5 1.5 0 0 1 3 0V11M11.2 10.6V4.4a1.5 1.5 0 0 1 3 0v6.4M14.2 10.8V6a1.5 1.5 0 0 1 3 0v6.6M17.2 9.8a1.5 1.5 0 0 1 3 0v5c0 3.6-2.8 6.2-6.4 6.2-2.4 0-4.2-1-5.6-3l-2.6-3.8a1.5 1.5 0 0 1 2.4-1.8l2.2 2.2"/>'),
  flashlight: S('<path d="M3 10h8v4H3zM11 9l5-3v12l-5-3M18.5 8.5l2-1.5M19.5 12h2.5M18.5 15.5l2 1.5"/>'),
  battery: S('<rect x="2.5" y="7.5" width="16" height="9" rx="1.5"/><path d="M21 10.5v3M6.5 10.5v3M9.5 10.5v3M12.5 10.5v3"/>'),
  jump: S('<path d="M5 4h14M12 20V8.5M7 13.5l5-5 5 5"/>'),
  sprint: S('<path d="M5 6.5l5.5 5.5L5 17.5M12 6.5l5.5 5.5-5.5 5.5"/>'),
  use: S('<circle cx="12" cy="12" r="5.2" fill="currentColor" stroke="none"/>'),
  drop: S('<path d="M12 4v11.5M7 10.5l5 5 5-5M5 20h14"/>'),
  pause: S('<path d="M9 5.5v13M15 5.5v13" stroke-width="3"/>'),
  moon: S('<path d="M20 14.6A8.2 8.2 0 0 1 9.4 4 8.2 8.2 0 1 0 20 14.6z"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>'),
  skull: S('<path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.2 4.1 2.6 5.1V18h8.8v-2.9C17.8 14.1 19 12.6 19 10a7 7 0 0 0-7-7z"/><circle cx="9.4" cy="11" r="1.5" fill="currentColor"/><circle cx="14.6" cy="11" r="1.5" fill="currentColor"/><path d="M10.2 18v3M13.8 18v3"/>'),
  house: S('<path d="M4 11.5L12 4l8 7.5M6 9.6V20h12V9.6M10 20v-5.5h4V20"/>'),
  bed: S('<path d="M3 18.5V6.5M3 13h18v5.5M21 18.5V16M6.5 13v-2.2A1.8 1.8 0 0 1 8.3 9h2.4a1.8 1.8 0 0 1 1.8 1.8V13"/>'),
  tent: S('<path d="M2 20L12 4l10 16zM9 20l3-5.5 3 5.5"/>'),
  warning: S('<path d="M12 3.5L2 20.5h20zM12 10v5M12 17.8v.4"/>'),
  bolt: S('<path d="M13.5 2.5L5 14h6.5l-1 7.5L19 10h-6.5z"/>'),
  cookie: S('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="14.6" cy="9.8" r="1" fill="currentColor"/><circle cx="10.6" cy="15" r="1" fill="currentColor"/><circle cx="15.2" cy="14.6" r="1" fill="currentColor"/>'),
  crouch: S('<circle cx="12" cy="5" r="2"/><path d="M12 7.5v5l-4 2.5 1.5 5M12 12.5l4 1.5 1 6M8 10l4-1 4 1.5"/>'),
  wrench: S('<path d="M14.5 6.5a4 4 0 0 0-5 5L3.5 17.5a2 2 0 0 0 3 3l6-6a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  chest: S('<rect x="3" y="9" width="18" height="11" rx="1"/><path d="M3 9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3M3 13h18M11 12h2v3h-2z"/>'),
  heart: S('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
  vent: S('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M6 9h12M6 12h12M6 15h12"/>'),
  flask: S('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 14h9"/>'),
  gift: S('<rect x="3.5" y="9" width="17" height="11"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9zM12 9c2-4 6-4 6-1.5S14 9 12 9z"/>'),
  rotate: S('<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4.5h4.5"/>'),
};

// Fill every <span data-icon="name"> in the page.
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (ICON[el.dataset.icon]) el.innerHTML = ICON[el.dataset.icon];
  });
}
