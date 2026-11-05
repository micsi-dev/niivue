/**
 * ColormapManager module
 *
 * Handles colormap assignment and management.
 * This module contains functions for:
 * - Setting continuous colormaps
 * - Setting discrete label colormaps
 * - Managing colormap and opacity properties
 */

import type { NVImage } from './index'
import { cmapper, type ColorMap } from '@/colortables'
import * as IntensityCalibration from '@/nvimage/IntensityCalibration'

/**
 * True if the colormap carries its own intensity range (min !== max).
 *
 * @param cm - Colormap name
 */
function hasColormapRange(cm: string | undefined): boolean {
    if (!cm) {
        return false
    }
    const cmap = cmapper.colormapFromKey(cm)
    const mn = cmap.min ?? 0
    const mx = cmap.max ?? 0
    return mn !== mx
}

/**
 * True if the image already has a usable window.
 *
 * @param nvImage - The NVImage instance
 */
function hasCalMinMax(nvImage: NVImage): boolean {
    return Number.isFinite(nvImage.cal_min) && Number.isFinite(nvImage.cal_max)
}

/**
 * Set continuous colormap.
 * Base function for niivue.setColormap().
 * Colormaps are continuously interpolated between 256 values (0..256).
 *
 * @param nvImage - The NVImage instance
 * @param cm - Colormap name
 */
export function setColormap(nvImage: NVImage, cm: string): void {
    const previous = nvImage._colormap
    nvImage._colormap = cm
    // Changing the colormap must not discard the current window (cal_min/cal_max).
    // Only compute it when it is not set yet, or when the new or previous colormap
    // defines its own intensity range (e.g. the ct_* colormaps), as before.
    if (!hasCalMinMax(nvImage) || hasColormapRange(cm) || hasColormapRange(previous)) {
        IntensityCalibration.calMinMax(nvImage)
    }
    if (nvImage.onColormapChange) {
        nvImage.onColormapChange(nvImage)
    }
}

/**
 * Set discrete label colormap.
 * Base function for niivue.setColormap().
 * Label colormaps are discretely sampled from an arbitrary number of colors.
 *
 * @param nvImage - The NVImage instance
 * @param cm - ColorMap object
 */
export function setColormapLabel(nvImage: NVImage, cm: ColorMap): void {
    nvImage.colormapLabel = cmapper.makeLabelLut(cm)
}

/**
 * Load label colormap from URL.
 *
 * @param nvImage - The NVImage instance
 * @param url - URL to load colormap from
 */
export async function setColormapLabelFromUrl(nvImage: NVImage, url: string): Promise<void> {
    nvImage.colormapLabel = await cmapper.makeLabelLutFromUrl(url)
}

/**
 * Get colormap name.
 *
 * @param nvImage - The NVImage instance
 * @returns Colormap name
 */
export function getColormap(nvImage: NVImage): string {
    return nvImage._colormap
}

/**
 * Get opacity value.
 *
 * @param nvImage - The NVImage instance
 * @returns Opacity value
 */
export function getOpacity(nvImage: NVImage): number {
    return nvImage._opacity
}

/**
 * Set opacity value.
 *
 * @param nvImage - The NVImage instance
 * @param opacity - Opacity value
 */
export function setOpacity(nvImage: NVImage, opacity: number): void {
    nvImage._opacity = opacity
    if (nvImage.onOpacityChange) {
        nvImage.onOpacityChange(nvImage)
    }
}
