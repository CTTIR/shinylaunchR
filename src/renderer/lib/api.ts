/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Typed wrapper over the contextBridge-exposed `window.shinylaunchR`.
 * Centralising access here keeps components decoupled from the global.
 */
import type { ShinyLaunchAPI } from '@shared/types';

export const api: ShinyLaunchAPI = window.shinylaunchR;

export type { ShinyLaunchAPI };
