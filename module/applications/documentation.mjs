const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PrismDocumentation extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance;

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
      scrollable: [""]
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

  _onRender(context, options) {
    super._onRender(context, options);
    const scroll = this.element.querySelector(".co2prism-doc-scroll");
    const article = scroll.querySelector("article");
    const entries = scroll.querySelector("nav ul");
    const headings = [...article.querySelectorAll("h2[id], h3[id]")];
    entries.replaceChildren(...headings.map(heading => {
      const item = document.createElement("li");
      if (heading.localName === "h3") item.classList.add("co2prism-doc-subsection");
      const link = document.createElement("a");
      link.setAttribute("href", `#${heading.id}`);
      link.textContent = heading.textContent.trim();
      item.append(link);
      return item;
    }));
    scroll.onclick = event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      event.preventDefault();
      const id = link.getAttribute("href").slice(1);
      const target = [...article.querySelectorAll("[id]")].find(element => element.id === id);
      if (!target) return;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12;
    };
  }
}
