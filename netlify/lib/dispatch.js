/*
  Production and dispatch actions. Each one changes the booking, writes a history record and
  rebuilds the money-free factory copy, all in the same transaction.

  Production may only move one step forward (and never skip a payment). QC and dispatch have their
  own actions because they need a file or transporter details. Admin may set any stage, and must
  write a reason when jumping off the normal path.
*/
import { ApiError, asApiError } from "./http.js";
import { PROD_NEXT, STAGE_KEYS } from "../../shared/portal-rules.js";
import { formatInr, todayIST } from "../../shared/portal-orders.js";
import { checkDispatchForm, checkDocsForm, checkShippingForm, cleanNote } from "../../shared/portal-validate.js";
import { mutateBooking } from "./orders.js";

const NOT_AT_STEP = "This order is not at that step. Reload the page.";
const DISPATCH_PATH = /^dispatch-docs\/([A-Za-z0-9]{8,40})\/([A-Za-z0-9._-]{1,80})$/;

function dispatchPath(path, bookingId, startsWith) {
  if (typeof path !== "string" || path.includes("..")) return false;
  const m = DISPATCH_PATH.exec(path);
  if (!m || m[1] !== bookingId) return false;
  return startsWith ? m[2].startsWith(startsWith) : true;
}

async function mustExist(files, path) {
  return files && path && (await files.exists(path));
}

async function setStage(ctx, payload) {
  const wanted = typeof payload.stage === "string" ? payload.stage.trim() : "";
  let note;
  try {
    note = cleanNote(payload.note);
  } catch (error) {
    throw asApiError(error);
  }
  if (!STAGE_KEYS.includes(wanted)) throw new ApiError(400, "invalid", "That stage does not exist.");

  return mutateBooking(ctx, payload.booking_id, async ({ booking }) => {
    if (ctx.role === "production") {
      if (PROD_NEXT[booking.stage] !== wanted) {
        throw new ApiError(403, "forbidden", "Your role cannot move this order to that stage.");
      }
    } else if (wanted === booking.stage) {
      throw new ApiError(409, "same_stage", "This order is already at that stage.");
    } else if (PROD_NEXT[booking.stage] !== wanted && !note) {
      throw new ApiError(400, "invalid", "Write the reason for this override — the customer will see it.");
    }
    return { next: wanted, note };
  });
}

async function submitQC(ctx, payload) {
  let note;
  try {
    note = cleanNote(payload.note);
  } catch (error) {
    throw asApiError(error);
  }
  const path = typeof payload.qc_path === "string" ? payload.qc_path : "";
  return mutateBooking(ctx, payload.booking_id, async ({ booking, nowMs, byName, id }) => {
    if (booking.stage !== "qc") throw new ApiError(409, "wrong_stage", "This order is not waiting for a QC report. Reload the page.");
    if (!dispatchPath(path, id, "qc-") || !(await mustExist(ctx.files, path))) {
      throw new ApiError(400, "invalid", "Attach the QC report before sending for clearance.");
    }
    const dispatch = {
      ...(booking.dispatch || {}),
      qc_path: path, qc_at: new Date(nowMs), qc_note: note, qc_by: byName
    };
    return {
      next: "awaiting_50",
      patch: { dispatch },
      note: note ? `QC passed. Report attached. ${note}` : "QC passed. Report attached."
    };
  });
}

async function markDispatched(ctx, payload) {
  let form;
  try {
    form = checkDispatchForm(payload, todayIST(ctx.now()));
  } catch (error) {
    throw asApiError(error);
  }
  return mutateBooking(ctx, payload.booking_id, async ({ booking }) => {
    if (booking.stage !== "ready_dispatch") throw new ApiError(409, "wrong_stage", NOT_AT_STEP);
    const dispatch = {
      ...(booking.dispatch || {}),
      transporter: form.transporter, vehicle_no: form.vehicle_no, lr_no: form.lr_no, dispatched_on: form.dispatched_on
    };
    const extra = form.note ? ` ${form.note}` : "";
    return {
      next: "dispatched",
      patch: { dispatch },
      note: `Dispatched by ${form.transporter}, vehicle ${form.vehicle_no}, LR ${form.lr_no}.${extra}`
    };
  });
}

async function setShipping(ctx, payload) {
  let form;
  try {
    form = checkShippingForm(payload);
  } catch (error) {
    throw asApiError(error);
  }
  return mutateBooking(ctx, payload.booking_id, async ({ booking }) => {
    if (booking.stage !== "shipping_quote" && booking.stage !== "awaiting_shipping") {
      throw new ApiError(409, "wrong_stage", NOT_AT_STEP);
    }
    const dispatch = { ...(booking.dispatch || {}), shipping_note: form.note };
    const next = form.amount > 0 ? "awaiting_shipping" : "docs_pending";
    const note = form.amount > 0
      ? `Shipping charge of ₹${formatInr(form.amount)} sent to the customer.${form.note ? " " + form.note : ""}`
      : `No shipping charge. Moved to invoicing.${form.note ? " " + form.note : ""}`;
    return { next, patch: { shipping_charge: form.amount, dispatch }, note };
  });
}

async function setDispatchDocs(ctx, payload) {
  let form;
  try {
    form = checkDocsForm(payload, todayIST(ctx.now()));
  } catch (error) {
    throw asApiError(error);
  }
  const invoicePath = typeof payload.invoice_path === "string" ? payload.invoice_path : "";
  const ewayPath = typeof payload.eway_path === "string" ? payload.eway_path : "";
  return mutateBooking(ctx, payload.booking_id, async ({ booking, id }) => {
    if (booking.stage !== "docs_pending" && booking.stage !== "ready_dispatch") {
      throw new ApiError(409, "wrong_stage", NOT_AT_STEP);
    }
    if (!dispatchPath(invoicePath, id) || !(await mustExist(ctx.files, invoicePath))) {
      throw new ApiError(400, "invalid", "Attach the tax invoice (PDF or photo).");
    }
    if (!dispatchPath(ewayPath, id) || !(await mustExist(ctx.files, ewayPath))) {
      throw new ApiError(400, "invalid", "Attach the e-way bill (PDF or photo).");
    }
    const dispatch = {
      ...(booking.dispatch || {}),
      invoice_no: form.invoice_no, invoice_date: form.invoice_date, invoice_path: invoicePath,
      eway_no: form.eway_no, eway_date: form.eway_date, eway_valid_till: form.eway_valid_till, eway_path: ewayPath
    };
    return {
      next: "ready_dispatch",
      patch: { dispatch },
      note: `Invoice ${form.invoice_no} and e-way bill ${form.eway_no} ready. Cleared for dispatch.`
    };
  });
}

export const DISPATCH_ACTIONS = {
  setStage: { roles: ["production", "admin"], run: setStage },
  submitQC: { roles: ["production", "admin"], run: submitQC },
  markDispatched: { roles: ["production", "admin"], run: markDispatched },
  setShipping: { roles: ["accounts", "admin"], run: setShipping },
  setDispatchDocs: { roles: ["accounts", "admin"], run: setDispatchDocs }
};
