const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PrismDocumentation extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance;
  #navigation;
  #history = [];
  #targetId;
  #renderScroll = 0;

  constructor() {
    if (PrismDocumentation.#instance) return PrismDocumentation.#instance;
    super();
    PrismDocumentation.#instance = this;
  }

  static DEFAULT_OPTIONS = {
    id: "co2prism-documentation",
    classes: ["co2prism-documentation"],
    position: { width: 820, height: 700 },
    window: { title: "CO2PRISM.Documentation.Title", resizable: true }
  };

  static PARTS = {
    manual: {
      template: "modules/co2prism/templates/documentation/documentation.hbs",
      scrollable: [".co2prism-doc-toc"]
    }
  };

  async render(options, legacyOptions) {
    if (options === true && this.rendered) {
      await this.maximize();
      this.bringToFront();
      return this;
    }
    return super.render(options, legacyOptions);
  }

  async _preRender(context, options) {
    this.#renderScroll = this.element?.querySelector(".co2prism-doc-article")?.scrollTop ?? 0;
    await super._preRender(context, options);
  }

  _onClose(options) {
    this.#navigation?.abort();
    this.#history.length = 0;
    this.#targetId = undefined;
    this.#renderScroll = 0;
    super._onClose(options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const manual = this.element.querySelector(".co2prism-doc-scroll");
    const article = manual.querySelector(".co2prism-doc-article");
    const nav = manual.querySelector(".co2prism-doc-nav");
    const entries = nav.querySelector(".co2prism-doc-toc > ul");
    const controls = nav.querySelector(".co2prism-doc-controls");
    const [previous, back, next] = controls.querySelectorAll("button");
    const targets = new Map([...article.querySelectorAll("[id]")].map(target => [target.id, target]));
    const links = new Map();

    const createEntry = heading => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.target = heading.id;
      button.textContent = heading.textContent.trim();
      item.append(button);
      links.set(heading, button);
      return item;
    };

    const chapters = [...article.querySelectorAll(".co2prism-doc-chapter")].map(section => {
      const heading = section.querySelector("h2[id]");
      const item = createEntry(heading);
      const subsections = document.createElement("ul");
      subsections.className = "co2prism-doc-subsections";
      subsections.append(...[...section.querySelectorAll("h3[id]")].map(createEntry));
      item.append(subsections);
      return { section, heading, item, subsections };
    });
    entries.replaceChildren(...chapters.map(chapter => chapter.item));

    let activeIndex = 0;
    const updateControls = () => {
      previous.disabled = activeIndex === 0;
      back.disabled = this.#history.length === 0;
      next.disabled = activeIndex === chapters.length - 1;
    };

    const selectTarget = (target, { focus = false, scrollTop } = {}) => {
      const section = target.closest(".co2prism-doc-chapter");
      activeIndex = chapters.findIndex(chapter => chapter.section === section);
      this.#targetId = target.id;
      for (const chapter of chapters) {
        const active = chapter.section === section;
        chapter.section.hidden = !active;
        chapter.subsections.hidden = !active;
        chapter.item.classList.toggle("co2prism-doc-active", active);
      }

      const chapterHeading = section.querySelector("h2[id]");
      const current = links.has(target) ? target : chapterHeading;
      for (const [heading, button] of links) {
        if (heading === current) button.setAttribute("aria-current", "location");
        else button.removeAttribute("aria-current");
      }

      if (focus) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      const position = scrollTop ?? (target === chapterHeading ? 0
        : article.scrollTop + target.getBoundingClientRect().top - article.getBoundingClientRect().top - 12);
      article.scrollTop = Math.max(0, Math.min(position, article.scrollHeight - article.clientHeight));
    };

    selectTarget(targets.get(this.#targetId) ?? chapters[0].heading, { scrollTop: this.#renderScroll });
    updateControls();
    this.#navigation?.abort();
    this.#navigation = new AbortController();
    manual.addEventListener("click", event => {
      const button = event.target.closest("button");
      const fromFooter = button && controls.contains(button);
      let target;
      if (fromFooter) {
        if (button.disabled) return;
        if (button === previous) target = chapters[activeIndex - 1].heading;
        if (button === next) target = chapters[activeIndex + 1].heading;
      } else if (button && entries.contains(button)) {
        target = targets.get(button.dataset.target);
      } else {
        const link = event.target.closest('a[href^="#"]');
        if (link && article.contains(link)) target = targets.get(link.getAttribute("href").slice(1));
      }
      if (!target && button !== back) return;
      event.preventDefault();
      event.stopPropagation();
      if (button === back) {
        const consultation = this.#history.pop();
        selectTarget(targets.get(consultation.targetId) ?? targets.get(consultation.chapterId), consultation);
      } else {
        const consultation = {
          chapterId: chapters[activeIndex].heading.id,
          targetId: this.#targetId,
          scrollTop: article.scrollTop
        };
        selectTarget(target, { focus: !fromFooter });
        if (this.#targetId !== consultation.targetId || article.scrollTop !== consultation.scrollTop) {
          this.#history.push(consultation);
        }
      }
      updateControls();
    }, { capture: true, signal: this.#navigation.signal });
  }
}
