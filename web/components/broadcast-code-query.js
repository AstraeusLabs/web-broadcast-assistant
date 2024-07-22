/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as AssistantModel from '../models/assistant-model.js';

/**
* Broadcast Code Query Component
*/

const template = document.createElement('template');
template.innerHTML = `
<style>
/* Styles go here */
</style>

<div>
<dialog id="dialog">
<form method="dialog">
<p>
<label>
Enter your Broadcast Code:
<input type="text" id="broadcastCodeField" required"/>
</label>
</p>
<button type="submit" id="normal-close">Submit</button>
<button type="submit" id="novalidate-close" formnovalidate>Cancel</button>
</form>
</dialog>
</div>
`;

export class BroadcastCodeQuery extends HTMLElement {
	#dialog
	#broadcastCodeField

	constructor() {
		super();

		const shadowRoot = this.attachShadow({mode: 'open'});
		shadowRoot.appendChild(template.content.cloneNode(true));

		this.queryBCCode = this.queryBCCode.bind(this);
		this.submitDialogBox = this.submitDialogBox.bind(this);
		this.cancelDialogBox = this.cancelDialogBox.bind(this);
	}
	
	connectedCallback() {
		console.log('connectedCallback - BroadcastCodeQuery')

		this.#dialog = this.shadowRoot?.querySelector('#dialog');
		this.#broadcastCodeField = this.shadowRoot?.querySelector('#broadcastCodeField');

		this.shadowRoot?.querySelector('#normal-close').addEventListener('click', this.submitDialogBox);
		this.shadowRoot?.querySelector('#novalidate-close').addEventListener('click', this.cancelDialogBox);
	}

	disconnectedCallback() {
		// Remove listeners, etc.
	}

	queryBCCode() {
		console.log('Request Broadcast Code from User')

		this.#dialog.showModal();
	}

	cancelDialogBox(e) {
		console.log('Cancel Dialog box')

		this.#dialog.close()
	}

	submitDialogBox(e) {
		console.log('Submitting Broadcast Code', e)

		const textEncoder = new TextEncoder();
		const broadcastCode = this.#broadcastCodeField.value
		const u8array = new Uint8Array(16);

		textEncoder.encodeInto(broadcastCode, u8array);

		this.dispatchEvent(new CustomEvent('bc-received', {detail: { arr: (u8array) }}));
	}

}
customElements.define('broadcast-code-query', BroadcastCodeQuery);
