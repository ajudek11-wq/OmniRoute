import { ICONS } from "./icons.js";

/**
 * One reusable panel: bottom sheet on phones, side panel on larger screens.
 * Views provide { key, eyebrow, title, html, binds?, after? }. Live values update through
 * [data-bind] elements so the DOM is not re-rendered (scroll position and sliders survive).
 */
export class Sheet {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById("sheet");
    this.body = document.getElementById("sheet-body");
    this.titleEl = document.getElementById("sheet-title");
    this.eyebrowEl = document.getElementById("sheet-eyebrow");
    this.view = null;
    const close = document.getElementById("sheet-close");
    close.innerHTML = ICONS.close;
    close.addEventListener("click", () => this.close());

    this.body.addEventListener("click", (e) => {
      const t = e.target.closest("[data-action]");
      if (!t || !this.body.contains(t)) return;
      app.action(t.dataset.action, t.dataset);
    });
    this.body.addEventListener("input", (e) => {
      const t = e.target.closest("[data-input]");
      if (t) app.action(t.dataset.input, { ...t.dataset, value: t.value, el: t });
    });
    this.body.addEventListener("change", (e) => {
      const t = e.target.closest("[data-change]");
      if (t) app.action(t.dataset.change, { ...t.dataset, value: t.value, el: t });
    });
    this.initDrag();
  }

  initDrag() {
    const grip = document.getElementById("sheet-grip");
    let startY = 0;
    let dy = 0;
    let dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      dy = 0;
      grip.setPointerCapture(e.pointerId);
      this.el.classList.add("dragging");
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      this.el.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove("dragging");
      this.el.style.transform = "";
      if (dy > 70) this.close();
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  isOpen(key) {
    return this.view && (key == null || this.view.key === key);
  }

  open(view) {
    this.view = view;
    this.eyebrowEl.textContent = view.eyebrow ?? "";
    this.titleEl.textContent = view.title ?? "";
    this.body.innerHTML = view.html;
    this.body.scrollTop = 0;
    this.el.classList.add("open");
    this.el.setAttribute("aria-hidden", "false");
    document.getElementById("app").classList.add("sheet-open");
    view.after?.(this.body);
    this.refresh();
    this.app.onSheetChange?.(view.key);
  }

  close() {
    if (!this.view) return;
    const key = this.view.key;
    this.view = null;
    this.el.classList.remove("open");
    this.el.setAttribute("aria-hidden", "true");
    document.getElementById("app").classList.remove("sheet-open");
    this.app.onSheetChange?.(null, key);
  }

  refresh() {
    if (!this.view?.binds) return;
    const binds = this.view.binds;
    for (const el of this.body.querySelectorAll("[data-bind]")) {
      const fn = binds[el.dataset.bind];
      if (!fn) continue;
      const v = fn(el);
      if (v == null) continue;
      if (typeof v === "string" || typeof v === "number") {
        if (el.textContent !== String(v)) el.textContent = v;
        continue;
      }
      if ("text" in v && el.textContent !== String(v.text)) el.textContent = v.text;
      if ("html" in v && el._html !== v.html) {
        el.innerHTML = v.html;
        el._html = v.html;
      }
      if ("cls" in v) {
        el.dataset.base ??= el.className;
        const next = `${el.dataset.base} ${v.cls}`.trim();
        if (el.className !== next) el.className = next;
      }
      if ("checked" in v) el.setAttribute("aria-checked", String(!!v.checked));
      if ("width" in v) el.style.width = v.width;
      if ("disabled" in v) el.disabled = !!v.disabled;
    }
    this.view.after2?.(this.body);
  }
}
