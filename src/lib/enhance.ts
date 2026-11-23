import type { SubmitFunction } from '@sveltejs/kit';

/**
 * use:enhance without the default form.reset(): Svelte sets `value`/`checked`
 * as properties, so a reset would blank edit forms and untick "Active" and the
 * glyph choice on add forms. `clear` lists text fields to empty after success.
 */
export function keep(clear: string[] = []): SubmitFunction {
	return ({ formElement }) =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success' || result.type === 'redirect') {
				for (const name of clear) {
					const el = formElement.elements.namedItem(name);
					if (el instanceof HTMLInputElement) el.value = '';
				}
			}
		};
}
