function formatDate(value) {
  if (!value) {
    return {
      utc: "sin fecha",
      local: "sin fecha",
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      utc: String(value),
      local: "fecha inválida",
    };
  }

  return {
    utc: date.toISOString(),
    local: date.toLocaleString("es-ES", {
      hour12: false,
    }),
  };
}

function printHeader(config) {
  console.log("");
  console.log("High Score League Local App");
  console.log("===========================");
  console.log(`Versión cliente: ${config.clientVersion || "sin versión"}`);
  console.log(`Pending: ${config.eventsPendingDirAbs}`);
  console.log(`Sent:    ${config.eventsSentDirAbs}`);
  console.log(`Failed:  ${config.eventsFailedDirAbs}`);
  console.log("");
}

function printEventCard(result, index) {
  const prefix = result.ok ? "OK" : "ERROR";
  const event = result.event || {};
  const dates = formatDate(event.detectedAt);

  console.log(`${index + 1}. [${prefix}] ${result.filename}`);

  if (result.event) {
    console.log(`   Juego: ${event.game || "desconocido"} (${event.rom || "sin rom"})`);
    console.log(`   Score: ${Number.isInteger(event.score) ? event.score : "inválido"}`);
    console.log(`   Fecha UTC: ${dates.utc}`);
    console.log(`   Fecha local: ${dates.local}`);
    console.log(`   Fuente: ${event.source || "sin source"}`);
    console.log(`   MAME: ${event.mameVersion || "sin mameVersion"}`);
    console.log(`   Plugin: ${event.pluginVersion || "sin pluginVersion"}`);

    if (event.scoreData) {
      const display = event.scoreData.displayScore;
      const tracked = event.scoreData.trackedScore;
      const rollovers = event.scoreData.rollovers;

      console.log(
        `   ScoreData: display=${display ?? "?"}, tracked=${tracked ?? "?"}, rollovers=${rollovers ?? "?"}`
      );
    }
  }

  if (result.errors.length > 0) {
    console.log("   Errores:");
    for (const error of result.errors) {
      console.log(`   - ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("   Avisos:");
    for (const warning of result.warnings) {
      console.log(`   - ${warning}`);
    }
  }

  console.log("");
}

function printSubmitResult(result) {
  console.log("");
  console.log(`Archivo: ${result.filename}`);

  if (result.submission) {
    console.log(`Juego: ${result.submission.game || "desconocido"} (${result.submission.rom || "sin rom"})`);
    console.log(`Score: ${Number.isInteger(result.submission.score) ? result.submission.score : "invalido"}`);
    console.log(`Week: ${result.submission.weekId || "sin weekId"}`);
    console.log(`Endpoint: ${result.submission.endpoint || "sin endpoint"}`);
  }

  if (result.recentWarning) {
    console.log(`Aviso: ${result.recentWarning}`);
  }

  if (result.ok) {
    console.log(`[OK] ${result.filename}`);

    if (result.action === "duplicate_sent") {
      console.log("El servidor indicó duplicado. Lo trato como éxito lógico.");
    } else {
      console.log("Submission enviada correctamente.");
    }

    if (result.status) {
      console.log(`HTTP: ${result.status}`);
    }

    if (result.duplicateKey) {
      console.log(`duplicateKey: ${result.duplicateKey}`);
    }

    if (result.movedTo) {
      console.log(`Movido a sent: ${result.movedTo}`);
    }

    if (result.body) {
      console.log("Respuesta:");
      console.log(JSON.stringify(result.body, null, 2));
    }

    console.log("");
    return;
  }

  console.log(`[ERROR] ${result.filename}`);
  console.log(result.message || "Error desconocido");

  if (result.action === "network_error" || result.action === "auth_required" || result.action === "pending") {
    console.log("El evento sigue en pending para reintentar.");
  }

  if (result.status) {
    console.log(`HTTP: ${result.status}`);
  }

  if (result.movedTo) {
    console.log(`Movido a failed: ${result.movedTo}`);
  }

  if (result.body) {
    console.log("Respuesta:");
    console.log(JSON.stringify(result.body, null, 2));
  }

  console.log("");
}

function printHelp() {
  console.log("");
  console.log("High Score League Local App");
  console.log("");
  console.log("Diagnostico:");
  console.log("  node app.js diagnose");
  console.log("");
  console.log("Desarrollo:");
  console.log("  node app.js sync-plugin [--dry-run]");
  console.log("");
  console.log("Juego:");
  console.log("  node app.js play <rom>");
  console.log("  node app.js practice <rom>");
  console.log("");
  console.log("Eventos:");
  console.log("  node app.js scan [pending|sent|failed]");
  console.log("  node app.js show <archivo.json> [pending|sent|failed]");
  console.log("  node app.js watch");
  console.log("  node app.js mark-sent <archivo.json>");
  console.log("  node app.js mark-failed <archivo.json> \"Motivo\"");
  console.log("  node app.js restore <sent|failed> <archivo.json>");
  console.log("");
  console.log("Cuenta:");
  console.log("  node app.js login [email]");
  console.log("  node app.js auth-status");
  console.log("  node app.js logout");
  console.log("");
  console.log("Subida:");
  console.log("  node app.js submit <archivo.json>");
  console.log("  node app.js submit-all");
  console.log("");
}

module.exports = {
  formatDate,
  printEventCard,
  printHeader,
  printHelp,
  printSubmitResult,
};
