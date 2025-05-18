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

				openApplications.push({ source: 'UAM', title, url, deadline });
			}
		}

		return openApplications;
	} catch (error) {
		console.error('Error fetching or parsing UAM:', error);
		return [];
	}
}

async function fetchComunidadMadridFinancialAid() {
	const url =
		'https://sede.comunidad.madrid/buscador/tipo/Ayudas%2C%20Becas%20y%20Subvenciones/nombre_consejeria/Consejer%C3%ADa%20de%20Cultura%2C%20Turismo%20y%20Deporte/nombre_consejeria/Consejer%C3%ADa%20de%20Educaci%C3%B3n%2C%20Ciencia%20y%20Universidades/nombre_consejeria/Consejer%C3%ADa%20de%20Familia%2C%20Juventud%20y%20Asuntos%20Sociales/perfil/Asociaciones%2C%20fundaciones%20y%20otras%20entidades/tematica/12985/tematica/12987/tematica/13020/tematica/13021/tematica/13021/TipoEstadoDinamico/En%20plazo';

	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to fetch page: ${response.status}`);

		const htmlText = await response.text();

		const openApplications = [];
		// Based on the provided HTML sample
		const itemRegex =
			/<li><div class="views-field views-field-nothing-1 data-content"><span class="field-content"><div id="[^"]*" class="content">(.*?)<\/div><\/span><\/div><\/li>/gs;

		let match;
		while ((match = itemRegex.exec(htmlText)) !== null) {
			const itemContent = match[1];

			// Extract title and URL
			const titleMatch = /<h3><a href="([^"]+)" title="[^"]+"><p>(.*?)<\/p><\/a><\/h3>/.exec(itemContent);
			if (!titleMatch) continue;

			const url = 'https://sede.comunidad.madrid' + titleMatch[1];
			const title = titleMatch[2].trim();

			// Extract deadline
			const deadlineMatch = /<div class="fin">Fin: <time datetime="[^"]+" class="datetime">(\d{2}\/\d{2}\/\d{4})<\/time>/.exec(itemContent);
			const deadline = deadlineMatch ? `Hasta: ${deadlineMatch[1]}` : null;

			openApplications.push({ source: 'Comunidad de Madrid', title, url, deadline });
		}

		return openApplications;
	} catch (error) {
		console.error('Error fetching or parsing Comunidad de Madrid:', error);
		return [];
	}
}

async function checkFinancialAid(env) {
	const aidList = [];
	(await fetchUAMFinancialAid()).forEach((aid) => aidList.push(aid));
	(await fetchComunidadMadridFinancialAid()).forEach((aid) => aidList.push(aid));

	const newAid = [];
	const prevAid = (await env.MISC.get('scheduled-financialaid', 'json')) || [];
	aidList.forEach((aid) => {
		const key =
			'scheduled-financialaid-' +
			(aid.source ? aid.source : 'nosource').toLowerCase().replaceAll(' ', '-') +
			'-' +
			aid.title.trim().toLowerCase().replaceAll(' ', '-');
		if (!prevAid.includes(key)) {
			newAid.push(aid);
			prevAid.push(key);
		}
	});

	if (newAid.length === 0) return;

	// Generar correo y enviarlo
	let html = `<div>`;
	let currentSource = '';

	// Sort aids by source to group them
	newAid.sort((a, b) => a.source.localeCompare(b.source));

	newAid.forEach((aid) => {
		const encodedTitle = aid.title
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
		const encodedSource = aid.source
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

		if (currentSource !== aid.source) {
			if (currentSource !== '') {
				html += `</div>`;
			}
			currentSource = aid.source;
			html += `<div style="margin-bottom: 20px;">`;
			html += `<h2 style="margin: 0; font-size: 24px; color: #333; margin-bottom: -10px; font-weight: bolder;">${encodedSource}</h2><hr style="margin-top: 0;"/>`; // Section title
		}

		// Choose the correct colors based on source
		let borderColor = '#5f9933'; // Default for UAM
		let linkColor = '#7ac143'; // Default for UAM

		if (aid.source === 'Comunidad de Madrid') {
			borderColor = '#993333';
			linkColor = '#c14343';
		}

		html += `
      <blockquote style="margin-top: 10px; margin-left: 0; padding-left: 10px; border-left: 5px solid ${borderColor};">
        <p style="margin-bottom: 0;"><strong style="font-size: 16px; color: #000;">${encodedTitle} </strong><span style="font-size: 14px; color: #666; text-wrap: nowrap;">${aid.deadline}</span></p>
        <a href="${aid.url}" style="font-size: 12px; color: ${linkColor}; text-decoration: none; font-weight: bold; display: inline-block;">${aid.url}</a>
      </blockquote>`;
	});

	if (currentSource !== '') {
		html += `</div>`;
	}

	html += `</div>`;

	await env.MISC.put('scheduled-financialaid', JSON.stringify(prevAid));

	const plural = newAid.length > 1 ? 's' : '';
	await env.EMAIL_SERVICE.sendEmailFromTemplate(
		1,
		{ name: 'Notificaciones', email: 'notifications@esn.tablerus.es' },
		[
			{ name: 'Héctor Tablero Díaz', email: 'hector.tablero@esnuam.org' },
			// { name: 'Secretaría', email: 'secretary@esnuam.org' },
			// { name: 'Tesorería', email: 'tesoreria@esnuam.org' },
		],
		null,
		`Hay ${newAid.length} nueva${plural} beca${plural}`,
		{ htmlContent: html, title: 'Nuevas Becas' }
	);

	return html;
}

export default {
	async scheduled(event, env, ctx) {
		switch (event.cron) {
			case '0 9 * * *':
				ctx.waitUntil(checkFinancialAid(env));
				break;
		}
	},
	// Uncomment for testing
	async fetch(request, env, ctx) {
		return new Response(await checkFinancialAid(env), { headers: { 'Content-Type': 'text/html' } });
	},
};
