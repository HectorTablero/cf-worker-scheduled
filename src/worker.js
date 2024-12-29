async function fetchUAMFinancialAid() {
  const url = 'https://www.uam.es/uam/estudios/becas-ayudas';

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch page: ${response.status}`);

    const htmlText = await response.text();

    const openApplications = [];
    const cardRegex = /<a href="([^"]+)" class="uam-becas-card.*?">(.*?)<\/a>/gs;
    const statusRegex = /<span class="uam-becas-status">Plazo de solicitud abierto<\/span>/;
    const titleRegex = /<p>(.*?)<\/p>/;
    const deadlineRegex = /<span class="uam-becas-date">\s*Solicitud:\s*(.*?)\s*<\/span>/;

    let match;
    while ((match = cardRegex.exec(htmlText)) !== null) {
      const cardHtml = match[2];
      const url = match[1];

      if (statusRegex.test(cardHtml)) {
        const titleMatch = titleRegex.exec(cardHtml);
        const deadlineMatch = deadlineRegex.exec(cardHtml);

        const title = titleMatch ? titleMatch[1].trim() : null;
        const deadline = deadlineMatch ? deadlineMatch[1].trim() : null;

        openApplications.push({ source: "UAM", title, url, deadline });
      }
    }

    return openApplications;

  } catch (error) {
    console.error('Error fetching or parsing UAM:', error);
    return [];
  }
}

async function checkFinancialAid(env) {
  const aidList = [];
  (await fetchUAMFinancialAid()).forEach((aid) => aidList.push(aid));

  const newAid = [];
  const prevAid = await env.MISC.get("scheduled-financialaid", "json") || [];
  aidList.forEach((aid) => {
    const key = "scheduled-financialaid-" + (aid.source ? aid.source : "nosource").toLowerCase() + "-" + aid.title.trim().toLowerCase().replaceAll(" ", "-");
    if (!prevAid.includes(key)) {
      newAid.push(aid);
      prevAid.push(key);
    }
  });

  if (newAid.length === 0) return;

  // Generar correo y enviarlo
  let html = `<div>`;
  let currentSource = "";
  newAid.forEach((aid) => {
    const encodedTitle = aid.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const encodedSource = aid.source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    if (currentSource !== aid.source) {
      if (currentSource !== "") {
        html += `</div>`;
      }
      currentSource = aid.source;
      html += `<div style="margin-bottom: 20px;">`;
      html += `<h2 style="margin: 0; font-size: 24px; color: #333; margin-bottom: -10px; font-weight: bolder;">${encodedSource}</h2><hr style="margin-top: 0;"/>`; // Section title
    }

    html += `
      <blockquote style="margin-top: 10px; margin-left: 0; padding-left: 10px; border-left: 5px solid #5f9933;">
        <p style="margin-bottom: 0;"><strong style="font-size: 16px; color: #000;">${encodedTitle} </strong><span style="font-size: 14px; color: #666; text-wrap: nowrap;">${aid.deadline}</span></p>
        <a href="${aid.url}" style="font-size: 12px; color: #7ac143; text-decoration: none; font-weight: bold; display: inline-block;">${aid.url}</a>
      </blockquote>`;
  });

  if (currentSource !== "") {
    html += `</div>`;
  }

  html += `</div>`;

  await env.MISC.put("scheduled-financialaid", JSON.stringify(prevAid));

  const plural = newAid.length > 1 ? "s" : "";
  await env.EMAIL_SERVICE.sendEmailFromTemplate(1, { name: "Notificaciones", email: "notifications@esn.tablerus.es"}, [{ name: "Héctor Tablero Díaz", email: "hector.tablero@esnuam.org"}, { name: "Secretaría", email: "secretary@esnuam.org"}, { name: "Tesorería", email: "tesoreria@esnuam.org"}], null, `Hay ${newAid.length} nueva${plural} beca${plural}`, { htmlContent: html, title: "Nuevas Becas" });

  return html;
}

export default {
  async scheduled(event, env, ctx) {
    switch (event.cron) {
      case "0 9 * * *":
        ctx.waitUntil(checkFinancialAid(env));
        break;
    }
  },
  // async fetch(request, env, ctx) {
  //   return new Response(await checkFinancialAid(env), { headers: { "Content-Type": "text/html" } });
  // }
};