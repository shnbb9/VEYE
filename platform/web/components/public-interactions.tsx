"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sendPublicRequest } from "@/lib/member-api";

export function PublicInteractions() {
  const pathname = usePathname();

  useEffect(() => {
    const cleanup: Array<() => void> = [];
    const on = (element: Element | null, event: string, listener: EventListenerOrEventListenerObject) => {
      if (!element) return;
      element.addEventListener(event, listener);
      cleanup.push(() => element.removeEventListener(event, listener));
    };

    document.querySelectorAll<HTMLAnchorElement>("a[data-noop='true']").forEach((link) => {
      on(link, "click", (event) => event.preventDefault());
    });
    document.querySelectorAll<HTMLAnchorElement>("a[href^='#']").forEach((link) => {
      on(link, "click", (event) => {
        const target = document.querySelector(link.getAttribute("href") ?? "");
        if (!target) return;
        event.preventDefault();
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
      });
    });

    const video = document.getElementById("veyeVideo") as HTMLVideoElement | null;
    const play = document.getElementById("videoPlay");
    const videoSection = video?.closest(".video");
    if (video && play && videoSection) {
      on(play, "click", (event) => {
        event.preventDefault();
        video.controls = true;
        void video.play().catch(() => undefined);
      });
      on(video, "play", () => videoSection.classList.add("is-playing"));
      on(video, "playing", () => videoSection.classList.add("is-playing"));
      on(video, "pause", () => videoSection.classList.remove("is-playing"));
      on(video, "ended", () => videoSection.classList.remove("is-playing"));
    }

    const categories = Array.from(document.querySelectorAll<HTMLButtonElement>(".help-cat"));
    const items = Array.from(document.querySelectorAll<HTMLElement>(".faq__item"));
    const columns = Array.from(document.querySelectorAll<HTMLElement>(".faq__col"));
    const search = document.querySelector<HTMLInputElement>(".help-search__input");
    const heading = document.querySelector<HTMLElement>(".help__cat");
    const empty = document.querySelector<HTMLElement>(".faq__empty");
    let activeCategory = "diet";
    let query = "";
    const titles: Record<string, string> = {
      about: "About Veye", subscription: "Subscription and My Account", diet: "Diet and Nutrition Terminology",
      platform: "Using the Platform", technical: "Technical Issues",
    };
    const renderFaqs = () => {
      if (!items.length) return;
      if (heading) heading.textContent = query ? "Search Results" : titles[activeCategory];
      let total = 0;
      items.forEach((item) => {
        const visible = query ? item.textContent?.toLowerCase().includes(query) : item.dataset.cat === activeCategory;
        item.hidden = !visible;
        if (visible) total += 1;
      });
      columns.forEach((column) => { column.hidden = !Array.from(column.querySelectorAll<HTMLElement>(".faq__item")).some((item) => !item.hidden); });
      if (empty) {
        empty.hidden = total !== 0;
        empty.textContent = query ? `No articles match “${query}”.` : "No articles in this category yet.";
      }
    };
    categories.forEach((button) => on(button, "click", () => {
      activeCategory = button.dataset.cat ?? activeCategory;
      query = "";
      if (search) search.value = "";
      categories.forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle("is-active", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      });
      renderFaqs();
    }));
    on(search, "input", () => {
      query = search?.value.trim().toLowerCase() ?? "";
      categories.forEach((button) => {
        const selected = !query && button.dataset.cat === activeCategory;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      renderFaqs();
    });
    renderFaqs();

    const ask = document.getElementById("helpAsk");
    const panel = document.getElementById("helpAskPanel");
    const field = document.getElementById("helpAskInput") as HTMLInputElement | null;
    const submit = document.getElementById("helpAskSubmit");
    const notice = document.getElementById("helpAskDone");
    on(ask, "click", () => {
      if (!panel) return;
      const opening = panel.hidden;
      panel.hidden = !opening;
      ask?.setAttribute("aria-expanded", String(opening));
      if (opening) field?.focus();
    });
    const emailField = document.getElementById("helpAskEmail") as HTMLInputElement | null;
    let sending = false;
    // A Help question lands in the console's Requests & Inbox (Help question).
    const sendQuestion = async () => {
      if (!field?.value.trim() || sending) { field?.focus(); return; }
      const email = emailField?.value.trim() ?? "";
      if (email && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) {
        if (notice) { notice.textContent = "Please enter a valid email address, or leave it blank."; notice.hidden = false; }
        emailField?.focus();
        return;
      }
      sending = true;
      if (submit) (submit as HTMLButtonElement).disabled = true;
      try {
        await sendPublicRequest({ kind: "help_question", message: field.value.trim(), email: email || null, page: "/help" });
        if (notice) {
          notice.textContent = email
            ? "Thanks — your question has been received. We will reply to the email you left."
            : "Thanks — your question has been received. Leave an email next time if you would like a reply.";
          notice.hidden = false;
        }
        field.value = "";
        if (emailField) emailField.value = "";
      } catch (reason) {
        if (notice) { notice.textContent = reason instanceof Error ? reason.message : "Your question could not be sent just now."; notice.hidden = false; }
      } finally {
        sending = false;
        if (submit) (submit as HTMLButtonElement).disabled = false;
      }
    };
    on(submit, "click", () => { void sendQuestion(); });
    on(field, "keydown", (event) => { if ((event as KeyboardEvent).key === "Enter") { event.preventDefault(); void sendQuestion(); } });

    return () => cleanup.forEach((dispose) => dispose());
  // Public pages share the same client shell during Next navigation. Rebind to
  // the freshly rendered page elements whenever that route changes.
  }, [pathname]);

  return null;
}
