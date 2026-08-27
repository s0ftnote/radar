let revision = 0;

export function notifyRadarChanged(): void {
  revision += 1;
}

export function liveUpdatesResponse(signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let seen = revision;
  let timer: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: ${seen}\n\n`));
      timer = setInterval(() => {
        if (seen === revision) return;
        seen = revision;
        controller.enqueue(encoder.encode(`event: radar\ndata: ${seen}\n\n`));
      }, 500);
      timer.unref();
      signal.addEventListener(
        "abort",
        () => {
          if (timer) clearInterval(timer);
          controller.close();
        },
        { once: true },
      );
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}
