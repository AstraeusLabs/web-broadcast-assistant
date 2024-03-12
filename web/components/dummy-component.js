/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
* Dummy Component
*
* This is just a template for components
*
* [EARLY DRAFT]
*/

const template = document.createElement('template');
template.innerHTML = `
<style>
/* Styles go here */
</style>
<div>
Dummy content
</div>
`;

export class DummyComponent extends HTMLElement {
	constructor() {
		super();

		const shadowRoot = this.attachShadow({mode: 'open'});
		shadowRoot.appendChild(template.content.cloneNode(true));
	}

	connectedCallback() {
		// Add listeners, etc.
	}

	disconnectedCallback() {
		// Remove listeners, etc.
	}
}
customElements.define('dummy-component', DummyComponent);
