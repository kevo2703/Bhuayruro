"use client";

import { useActionState } from "react";
import Link from "next/link";
import { actualizarProducto, eliminarProducto, type ProductoFormState } from "../actions";

type Props = {
  producto: {
    id: string;
    nombre: string;
    presentacion: string;
    laboratorio: string;
    principio_activo: string;
    categoria: string;
    requiere_receta: boolean;
    activo: boolean;
  };
  precioActualTotal: number | null;
  gtin: string | null;
};

const initialState: ProductoFormState = {};

export function EditarProductoForm({ producto, precioActualTotal, gtin }: Props) {
  const [state, formAction, pending] = useActionState(actualizarProducto, initialState);

  return (
    <>
      <form action={formAction} className="space-y-4 bg-white/5 rounded-lg p-6">
        <input type="hidden" name="id" value={producto.id} />

        <Field
          label="Nombre *"
          name="nombre"
          defaultValue={producto.nombre}
          error={state.fieldErrors?.nombre}
          required
        />
        <Field
          label="Presentación"
          name="presentacion"
          defaultValue={producto.presentacion}
          error={state.fieldErrors?.presentacion}
        />
        <Field
          label="Laboratorio"
          name="laboratorio"
          defaultValue={producto.laboratorio}
          error={state.fieldErrors?.laboratorio}
        />
        <Field
          label="Principio activo"
          name="principio_activo"
          defaultValue={producto.principio_activo}
          error={state.fieldErrors?.principio_activo}
        />
        <Field
          label="Categoría"
          name="categoria"
          defaultValue={producto.categoria}
          error={state.fieldErrors?.categoria}
        />

        {gtin && (
          <div>
            <p className="text-sm opacity-60">
              GTIN: <span className="font-mono">{gtin}</span>{" "}
              <span className="opacity-50 ml-2">(no editable en este sprint)</span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Precio compra (opcional, S/ sin IGV)"
            name="precio_compra"
            type="number"
            step="0.01"
            error={state.fieldErrors?.precio_compra}
          />
          <Field
            label={`Nuevo precio venta (actual ${precioActualTotal ?? "—"})`}
            name="precio_total"
            type="number"
            step="0.01"
            error={state.fieldErrors?.precio_total}
            placeholder="Dejar vacío para mantener"
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requiere_receta"
              defaultChecked={producto.requiere_receta}
            />
            <span>Requiere receta médica</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="activo" defaultChecked={producto.activo} />
            <span>Producto activo (visible en mostrador)</span>
          </label>
        </div>

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
            {pending ? "Guardando..." : "Guardar cambios"}
          </button>
          <Link href="/catalogo" className="px-4 py-2 rounded hover:bg-white/5 text-sm">
            Cancelar
          </Link>
        </div>
      </form>

      <form
        action={eliminarProducto}
        className="mt-6 bg-red-500/5 border border-red-500/20 rounded-lg p-4"
      >
        <input type="hidden" name="id" value={producto.id} />
        <h3 className="text-sm font-semibold text-red-300">Zona peligrosa</h3>
        <p className="text-xs opacity-70 mt-1">
          Eliminar el producto del catálogo (soft delete). No se borra la data — queda con
          deleted_at. Las ventas históricas siguen accesibles.
        </p>
        <button
          type="submit"
          className="mt-3 px-3 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm"
        >
          Eliminar producto
        </button>
      </form>
    </>
  );
}

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  step?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  error?: string;
};

function Field({
  label,
  name,
  type = "text",
  step,
  placeholder,
  required,
  defaultValue,
  error,
}: FieldProps) {
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
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
