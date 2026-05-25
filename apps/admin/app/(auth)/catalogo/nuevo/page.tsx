"use client";

import { useActionState } from "react";
import Link from "next/link";
import { crearProducto, type ProductoFormState } from "../actions";

const initialState: ProductoFormState = {};

export default function NuevoProductoPage() {
  const [state, formAction, pending] = useActionState(crearProducto, initialState);

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <Link href="/catalogo" className="text-sm opacity-60 hover:opacity-100">
          ← Volver al catálogo
        </Link>
        <h1 className="text-3xl font-bold mt-2">Nuevo producto</h1>
      </header>

      <form action={formAction} className="space-y-4 bg-white/5 rounded-lg p-6">
        <Field label="Nombre *" name="nombre" error={state.fieldErrors?.nombre} required />
        <Field
          label="Presentación"
          name="presentacion"
          placeholder="ej: Caja x 10 tabletas"
          error={state.fieldErrors?.presentacion}
        />
        <Field
          label="Laboratorio"
          name="laboratorio"
          error={state.fieldErrors?.laboratorio}
        />
        <Field
          label="Principio activo"
          name="principio_activo"
          placeholder="ej: Paracetamol 500 mg"
          error={state.fieldErrors?.principio_activo}
        />
        <Field
          label="Categoría"
          name="categoria"
          placeholder="ej: Analgésico"
          error={state.fieldErrors?.categoria}
        />
        <Field
          label="GTIN (código de barras)"
          name="gtin"
          placeholder="13 dígitos"
          error={state.fieldErrors?.gtin}
        />

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Precio compra (S/, sin IGV) — opcional"
            name="precio_compra"
            type="number"
            step="0.01"
            error={state.fieldErrors?.precio_compra}
          />
          <Field
            label="Precio venta (S/, con IGV) *"
            name="precio_total"
            type="number"
            step="0.01"
            required
            error={state.fieldErrors?.precio_total}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="requiere_receta" />
          <span>Requiere receta médica</span>
        </label>

        {state.error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm">
            {state.error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-medium disabled:opacity-50"
          >
            {pending ? "Creando..." : "Crear producto"}
          </button>
          <Link href="/catalogo" className="px-4 py-2 rounded hover:bg-white/5 text-sm">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}

type FieldProps = {
  label: string;
  name: string;
  type?: string | undefined;
  step?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  error?: string | undefined;
};

function Field({ label, name, type = "text", step, placeholder, required, error }: FieldProps) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm mb-1 opacity-80">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
