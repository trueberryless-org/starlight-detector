export const prerender = false;

import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: "URL parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    // Validate URL
    new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Fetch the target website (follow redirects automatically)
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StarlightDetector/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000), // 15s timeout for slower redirects
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch: ${response.status}` }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Get the final URL after all redirects
    // response.url gives us the final URL after HTTP redirects, HTML meta redirects, etc.
    let finalUrl = response.url || targetUrl;
    const html = await response.text();

    // Check for HTML meta refresh redirects (not followed by fetch)
    const metaRefreshRegex =
      /<meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)["']/i;
    const metaRefreshMatch = html.match(metaRefreshRegex);

    if (metaRefreshMatch) {
      // Found a meta refresh, resolve the URL and fetch that page instead
      const redirectTarget = metaRefreshMatch[1];
      const resolvedUrl = new URL(redirectTarget, finalUrl).toString();

      const redirectResponse = await fetch(resolvedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; StarlightDetector/1.0)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });

      if (redirectResponse.ok) {
        finalUrl = redirectResponse.url || resolvedUrl;
        const redirectedHtml = await redirectResponse.text();

        // Check the redirected page for Starlight
        const metaRegex =
          /<meta\s+name=["']generator["']\s+content=["']Starlight\s+v([\d.]+)["']/i;
        const match = redirectedHtml.match(metaRegex);

        const result = match
          ? { isStarlight: true, version: match[1], finalUrl }
          : { isStarlight: false, finalUrl };

        const cacheUrl = new URL(finalUrl);
        cacheUrl.search = "";

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control":
              "public, max-age=3628800, stale-while-revalidate=86400",
            "X-Cache-Key": cacheUrl.toString(),
          },
        });
      }
    }

    // Look for Starlight meta tag in the current page
    const metaRegex =
      /<meta\s+name=["']generator["']\s+content=["']Starlight\s+v([\d.]+)["']/i;
    const match = html.match(metaRegex);

    const result = match
      ? { isStarlight: true, version: match[1], finalUrl }
      : { isStarlight: false, finalUrl };

    // Use the final URL (after redirects) for cache key
    const cacheUrl = new URL(finalUrl);
    cacheUrl.search = "";

    // Cache for 6 weeks (3628800 seconds)
    // Use stale-while-revalidate for better UX
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "public, max-age=3628800, stale-while-revalidate=86400",
        "X-Cache-Key": cacheUrl.toString(),
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to check website",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
