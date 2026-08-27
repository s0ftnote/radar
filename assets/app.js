const copyNotice = document.querySelector("[data-copy-notice]");

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const command = button.getAttribute("data-copy");
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      showCopyNotice(`已复制 ${command}，回到 Agent 对话中粘贴即可。`);
    } catch {
      showCopyNotice(`无法自动复制，请手动复制：${command}`);
    }
  });
}

function showCopyNotice(message) {
  if (!copyNotice) return;
  copyNotice.textContent = message;
  copyNotice.hidden = false;
  window.setTimeout(() => {
    copyNotice.hidden = true;
  }, 3200);
}

let dirty = false;
for (const field of document.querySelectorAll("form input, form textarea, form select")) {
  field.addEventListener("input", () => {
    dirty = true;
  });
}
for (const form of document.querySelectorAll("form")) {
  form.addEventListener("submit", (event) => {
    if (form.hasAttribute("data-confirm-remove")) {
      const accepted = window.confirm("确定从工作台移除这条任务吗？任务历史会继续保留。");
      if (!accepted) {
        event.preventDefault();
        return;
      }
    }
    dirty = false;
  });
}

const updateNotice = document.querySelector("[data-update-notice]");
const refreshButton = document.querySelector("[data-refresh]");
refreshButton?.addEventListener("click", () => window.location.reload());

const liveLabel = document.querySelector("[data-live-label]");
const events = new EventSource("/events");
events.addEventListener("ready", () => {
  if (liveLabel) liveLabel.textContent = "实时同步中";
});
events.addEventListener("radar", () => {
  if (dirty) {
    if (updateNotice) updateNotice.hidden = false;
    return;
  }
  window.location.reload();
});
events.onerror = () => {
  if (liveLabel) liveLabel.textContent = "正在重新连接";
};

const revealTargets = [
  ...document.querySelectorAll(
    "[data-reveal], .page-heading, .task-heading, .document-heading, .report-heading, .content-section, .report-section, .report-sources",
  ),
].filter((target, index, targets) => targets.indexOf(target) === index);

if (revealTargets.length > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealTargets.forEach((target, index) => {
    target.classList.add("reveal-target");
    target.style.setProperty("--reveal-order", String(Math.min(index, 6)));
  });
  document.documentElement.classList.add("motion-ready");

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  window.requestAnimationFrame(() => revealTargets.forEach((target) => observer.observe(target)));
}
