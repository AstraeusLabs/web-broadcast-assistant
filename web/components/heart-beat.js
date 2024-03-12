/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as AssistantModel from '../models/assistant-model.js';

/*
* Heartbeat Component
*/

const template = document.createElement('template');
template.innerHTML = `
<style>

	.heartbeat_img {
		content:url("./web/images/heart_inactive.svg");
	}

	div {
		display: flex;
		flex-direction: column;
	}

	.heartbeat_img.animation {
		animation: heart_beat 500ms 1;
	}

	@keyframes heart_beat {
		0% {
			content:url("./web/images/heart_active.svg");
		}
		100% {
			content:url("./web/images/heart_inactive.svg");
		}
	}
	</style>

	<div>
	<img id="heartImg" class="heartbeat_img">
	</div>

	`;

export class HeartBeat extends HTMLElement {
	#heartbeatImage
	#model

	constructor() {
		super();

		const shadowRoot = this.attachShadow({mode: 'open'});
	}

	connectedCallback() {
		console.log("connectedCallback - HeartBeat");

		this.shadowRoot?.appendChild(template.content.cloneNode(true));

		// Add listeners, etc.
		this.heartbeatImage = this.shadowRoot?.querySelector('#heartImg');

		this.#model = AssistantModel.getInstance();

		this.#model.addEventListener('heartbeat-received', (event) => {
			const heartbeat_count = event.detail;
			//console.log("Heartbeat: " + heartbeat_count);
			// Heartbeat tick received, begin animation
			this.heartbeatImage.classList.add('animation')
		});

		this.heartbeatImage.addEventListener('click', (event) => {
			//console.log("Clicked Heartbeat")
			this.#model.startHeartbeat();
		});

		this.heartbeatImage.addEventListener("animationend", (event) => {
			// Heartbeat animation ended, remove the animator until next tick
			this.heartbeatImage.classList.remove('animation')
		});
	}

	disconnectedCallback() {
		// Remove listeners, etc.
	}

}
customElements.define('heartbeat-indicator', HeartBeat);
