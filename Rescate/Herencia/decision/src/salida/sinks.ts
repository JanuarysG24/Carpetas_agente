/**
 * WO-45b — la entrega del resumen. `SummarySinkPort` con sus dos destinos.
 *
 * ============ A la falla de entrega, REGISTRO — nunca silencio ============
 *
 * `session_archive` recibe TODO resumen: es el registro auditable y la fuente del
 * informe. `alert_channel` lo recibe cuando `escalate: true` — el personal alertado
 * no recibe un timbre, recibe el caso.
 *
 * Si el canal se cae, la alerta YA fue emitida por la `Decision` y el resumen persiste
 * en el archivo **con la falla registrada dentro del propio recibo**. El resumen jamas
 * se pierde por un destino caido, y que el canal fallara queda escrito en vez de
 * desaparecer — un fallo de entrega que no deja rastro es indistinguible de una
 * entrega que nunca hizo falta.
 *
 * Orden deliberado: el ARCHIVO primero. Si se entregara al canal antes de persistir y
 * el proceso muriera en medio, habria una alerta sin caso que la sustente.
 *
 * ==========================================================================
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CallSummary, DeliveryReceipt, SummaryDestination, SummarySinkPort } from "@techsphere/contracts";

/** Un destino de entrega. Los dos de la spec §8b.2 implementan esto. */
export interface Destino {
  nombre: SummaryDestination;
  entregar(resumen: CallSummary): void;
}

/**
 * `session_archive` — persistencia local, consultable por la consola y por el informe.
 * Un archivo por sesion, con el `session_id` como nombre: el resumen de una llamada de
 * hace un mes se encuentra sin indice y sin base de datos.
 */
export class ArchivoDeSesiones implements Destino {
  readonly nombre = "session_archive" as const;
  private readonly raiz: string;
  /** Espejo en memoria: la demo y las pruebas leen sin tocar disco. */
  private readonly memoria = new Map<string, CallSummary>();

  constructor(raiz: string) {
    this.raiz = raiz;
    mkdirSync(raiz, { recursive: true });
  }

  entregar(resumen: CallSummary): void {
    this.memoria.set(resumen.session_id, resumen);
    writeFileSync(join(this.raiz, `${resumen.session_id}.json`), JSON.stringify(resumen, null, 2), "utf8");
  }

  leer(session_id: string): CallSummary | null {
    const enMemoria = this.memoria.get(session_id);
    if (enMemoria) return enMemoria;
    try {
      return JSON.parse(readFileSync(join(this.raiz, `${session_id}.json`), "utf8")) as CallSummary;
    } catch {
      return null;
    }
  }
}

/**
 * `alert_channel` — destino configurable. En desarrollo, un panel en memoria y una
 * linea por consola; el transporte real (webhook, correo) es configuracion de
 * despliegue y no de esta orden.
 *
 * Lo que si es de esta orden: que el personal reciba EL CASO y no un timbre. De ahi
 * que la linea lleve criticidad, razon y trazas, y no solo el `session_id`.
 */
export class CanalDeAlerta implements Destino {
  readonly nombre = "alert_channel" as const;
  readonly recibidos: CallSummary[] = [];
  private readonly caido: boolean;
  private readonly escribir: (linea: string) => void;

  constructor(opciones: { caido?: boolean; escribir?: (linea: string) => void } = {}) {
    this.caido = opciones.caido ?? false;
    this.escribir = opciones.escribir ?? (() => {});
  }

  entregar(resumen: CallSummary): void {
    if (this.caido) throw new Error("el canal de alerta no responde");
    this.recibidos.push(resumen);
    this.escribir(
      `[ALERTA] ${resumen.session_id} · ${resumen.decision.criticality} · ${resumen.decision.reason_code} · ` +
        `${resumen.findings.filter((f) => f.normalized !== null).length}/${resumen.findings.length} unidades con valor · ` +
        resumen.decision.reason.slice(0, 160),
    );
  }
}

export interface FallaDeEntrega {
  destino: SummaryDestination;
  session_id: string;
  motivo: string;
  ts: string;
}

/**
 * El puerto. Aplica la POLITICA de destinos y no la recibe: quien llama dice a donde,
 * pero si `session_archive` no esta en la lista es un error de programacion, no una
 * opcion — y por eso se añade en vez de rechazarse. Perder el registro auditable por
 * una lista mal armada seria el peor modo de fallar de esta pieza.
 */
export class SumideroDeResumenes implements SummarySinkPort {
  readonly fallas: FallaDeEntrega[] = [];
  private readonly archivo: ArchivoDeSesiones;
  private readonly canal: Destino;

  constructor(archivo: ArchivoDeSesiones, canal: Destino) {
    this.archivo = archivo;
    this.canal = canal;
  }

  deliver(summary: CallSummary, destinations: SummaryDestination[]): DeliveryReceipt {
    const pedidos = new Set<SummaryDestination>(destinations);
    pedidos.add("session_archive");

    const delivered: string[] = [];
    const failed: string[] = [];

    // El archivo PRIMERO: una alerta sin caso que la sustente es peor que una alerta
    // que tarda un instante mas.
    for (const destino of [this.archivo, this.canal]) {
      if (!pedidos.has(destino.nombre)) continue;
      try {
        destino.entregar(summary);
        delivered.push(destino.nombre);
      } catch (e) {
        failed.push(destino.nombre);
        this.fallas.push({
          destino: destino.nombre,
          session_id: summary.session_id,
          motivo: (e as Error).message,
          ts: new Date().toISOString(),
        });
      }
    }

    return { delivered, failed };
  }
}
