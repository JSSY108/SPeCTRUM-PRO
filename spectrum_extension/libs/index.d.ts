/**
 * PPTX Viewer - A lightweight PowerPoint viewer for the browser.
 *
 * @packageDocumentation
 *
 * ## Quick Start - Full Viewer
 * ```typescript
 * import { PPTXViewer } from 'pptx-viewer';
 *
 * const viewer = new PPTXViewer('#container');
 * await viewer.load(file);
 * ```
 *
 * ## Custom Rendering - Just the Parser & Renderer
 * ```typescript
 * import { loadPresentation, renderSlideToElement } from 'pptx-viewer';
 *
 * const presentation = await loadPresentation(file);
 * renderSlideToElement(presentation, 0, document.getElementById('slide'));
 * ```
 */

/**
 * Arrow head style for line endings.
 */
export declare interface ArrowHead {
    /** Arrow type */
    type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';
    /** Arrow width: small, medium, large */
    width?: 'sm' | 'med' | 'lg';
    /** Arrow length: small, medium, large */
    length?: 'sm' | 'med' | 'lg';
}

/**
 * Slide background.
 */
export declare interface Background {
    fill: Fill;
}

/**
 * Base type for all slide elements.
 */
declare interface BaseElement {
    /** Unique identifier */
    id: string;
    /** Element type discriminator */
    type: ElementType;
    /** Position and size */
    bounds: Bounds;
    /** Rotation in degrees */
    rotation?: number;
    /** Placeholder info (if this element is a placeholder) */
    placeholder?: PlaceholderInfo;
    /** Overall opacity (0-1, where 1 is fully opaque) */
    opacity?: number;
}

/**
 * Position and size bounds.
 */
export declare interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Bullet point style.
 */
export declare interface BulletStyle {
    type: 'bullet' | 'number';
    /** Custom bullet character */
    char?: string;
    /** Starting number for numbered lists */
    startAt?: number;
    /** Number format type (e.g., 'arabicPeriod', 'alphaLcParenR') */
    numberType?: string;
    /** Bullet color */
    color?: Color;
    /** Bullet font family */
    font?: string;
    /** Bullet size as percentage of text size (e.g., 100 = same size) */
    sizePercent?: number;
}

/**
 * Cell border definitions.
 */
export declare interface CellBorders {
    top?: Stroke;
    right?: Stroke;
    bottom?: Stroke;
    left?: Stroke;
}

/**
 * Chart data structure.
 */
export declare interface ChartData {
    /** Category labels (x-axis for most charts) */
    categories: string[];
    /** Data series */
    series: ChartSeries[];
}

/**
 * A chart element.
 */
export declare interface ChartElement extends BaseElement {
    type: 'chart';
    /** Chart type */
    chartType: ChartType;
    /** Chart data (series, categories, values) */
    data: ChartData;
    /** Chart title */
    title?: string;
    /** Chart styling options */
    style?: ChartStyle;
    /** Fallback image if native rendering fails */
    fallbackImage?: string;
}

/**
 * Chart rendering options.
 */
export declare interface ChartRenderOptions {
    /** Theme colors for series coloring */
    themeColors: ThemeColors;
    /** Whether to show the legend */
    showLegend?: boolean;
    /** Whether to show data labels */
    showDataLabels?: boolean;
    /** Whether to show gridlines */
    showGridlines?: boolean;
}

/**
 * A data series in a chart.
 */
export declare interface ChartSeries {
    /** Series name/label */
    name?: string;
    /** Data values */
    values: number[];
    /** Series color */
    color?: Color;
}

/**
 * Chart styling options.
 */
export declare interface ChartStyle {
    /** Show legend */
    showLegend?: boolean;
    /** Legend position */
    legendPosition?: 'top' | 'bottom' | 'left' | 'right';
    /** Show data labels */
    showDataLabels?: boolean;
    /** Show gridlines */
    showGridlines?: boolean;
    /** Chart colors (overrides series colors) */
    colors?: Color[];
}

/**
 * Supported chart types.
 */
export declare type ChartType = 'bar' | 'column' | 'stackedColumn' | 'pie' | 'doughnut' | 'line' | 'area' | 'scatter' | 'unknown';

/**
 * Color representation.
 */
export declare interface Color {
    /** Hex color value (e.g., "#FF0000") */
    hex: string;
    /** Opacity from 0 to 1 */
    alpha: number;
}

/**
 * Color mapping from scheme colors to theme colors.
 * Maps logical color names to theme color slots.
 */
export declare interface ColorMap {
    /** Background 1 */
    bg1?: string;
    /** Background 2 */
    bg2?: string;
    /** Text 1 */
    tx1?: string;
    /** Text 2 */
    tx2?: string;
    /** Accent colors 1-6 */
    accent1?: string;
    accent2?: string;
    accent3?: string;
    accent4?: string;
    accent5?: string;
    accent6?: string;
    /** Hyperlink */
    hlink?: string;
    /** Followed hyperlink */
    folHlink?: string;
}

/**
 * Creates an empty slide placeholder.
 *
 * @param slideSize - Slide dimensions
 * @param message - Optional message to display
 * @returns SVG element
 */
export declare function createEmptySlide(slideSize: Size, message?: string): SVGSVGElement;

/**
 * A SmartArt diagram element.
 * Contains pre-computed shapes from PowerPoint's diagram drawing XML.
 */
export declare interface DiagramElement extends BaseElement {
    type: 'diagram';
    /** Child elements (shapes, text) from the diagram */
    children: SlideElement[];
    /** Diagram name/type for debugging */
    diagramType?: string;
    /** Fallback image if native rendering fails */
    fallbackImage?: string;
}

/**
 * Discriminator for element types.
 */
export declare type ElementType = 'shape' | 'text' | 'image' | 'group' | 'table' | 'chart' | 'diagram';

/**
 * Represents an embedded font extracted from the presentation.
 */
export declare interface EmbeddedFont {
    /** Font family name */
    name: string;
    /** Blob URL to the font file */
    url: string;
    /** Font format */
    format: 'truetype' | 'opentype';
    /** Original file path in archive */
    path: string;
}

/**
 * Event listener function type.
 */
declare type EventListener_2<T> = (data: T) => void;

/**
 * Extracts a PPTX file from various input sources.
 *
 * @param source - PPTX file as File, ArrayBuffer, Uint8Array, or URL
 * @returns Extracted archive contents
 *
 * @example
 * // From File input
 * const file = inputElement.files[0];
 * const archive = await extractPPTX(file);
 *
 * @example
 * // From URL
 * const archive = await extractPPTX('/presentations/demo.pptx');
 *
 * @example
 * // From ArrayBuffer
 * const buffer = await fetch(url).then(r => r.arrayBuffer());
 * const archive = await extractPPTX(buffer);
 */
export declare function extractPPTX(source: File | ArrayBuffer | Uint8Array | string): Promise<PPTXArchive>;

/**
 * Error thrown when fetching a remote file fails.
 */
export declare class FetchError extends PPTXError {
    readonly url: string;
    readonly status?: number;
    constructor(url: string, status?: number, statusText?: string);
}

/**
 * Fill style for shapes and backgrounds.
 */
export declare type Fill = SolidFill | GradientFill | PatternFill | ImageFill | NoFill;

/**
 * Gets the slide count without fully parsing the presentation.
 *
 * @param archive - Extracted PPTX archive
 * @returns Number of slides
 */
export declare function getSlideCount(archive: PPTXArchive): number;

/**
 * Gets all slides as thumbnail images.
 *
 * @param presentation - Loaded presentation
 * @param thumbnailWidth - Width of each thumbnail
 * @returns Array of SVG elements
 *
 * @example
 * ```typescript
 * import { loadPresentation, getThumbnails } from 'pptx-viewer';
 *
 * const presentation = await loadPresentation(file);
 * const thumbnails = getThumbnails(presentation, 200);
 *
 * thumbnails.forEach((svg, index) => {
 *   const wrapper = document.createElement('div');
 *   wrapper.appendChild(svg);
 *   wrapper.onclick = () => goToSlide(index);
 *   sidebar.appendChild(wrapper);
 * });
 * ```
 */
export declare function getThumbnails(presentation: Presentation, thumbnailWidth?: number): SVGSVGElement[];

export declare interface GradientFill {
    type: 'gradient';
    /** Gradient type (linear or radial) */
    gradientType: 'linear' | 'radial';
    /** Gradient angle in degrees (for linear gradients) */
    angle: number;
    /** Gradient color stops */
    stops: GradientStop[];
    /** Radial gradient path type (for radial gradients) */
    path?: 'circle' | 'rect';
    /** Fill to rect - defines the rectangle that bounds the gradient (for radial) */
    fillToRect?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
}

export declare interface GradientStop {
    /** Position from 0 to 1 */
    position: number;
    color: Color;
}

/**
 * A group of elements.
 */
export declare interface GroupElement extends BaseElement {
    type: 'group';
    /** Child elements in this group */
    children: SlideElement[];
}

/**
 * Image crop settings (percentages from each edge).
 * Values are 0-100 representing percentage of image to crop from each side.
 */
export declare interface ImageCrop {
    /** Percentage to crop from left edge */
    left: number;
    /** Percentage to crop from top edge */
    top: number;
    /** Percentage to crop from right edge */
    right: number;
    /** Percentage to crop from bottom edge */
    bottom: number;
}

/**
 * An image element.
 */
export declare interface ImageElement extends BaseElement {
    type: 'image';
    /** Image source (data URL or blob URL) */
    src: string;
    /** Original image MIME type */
    mimeType: string;
    /** Alt text for accessibility */
    altText?: string;
    /** Shadow effect */
    shadow?: Shadow;
    /** Crop rectangle (percentages from each edge) */
    crop?: ImageCrop;
}

export declare interface ImageFill {
    type: 'image';
    src: string;
    /** How to fit the image */
    mode: 'stretch' | 'tile' | 'cover' | 'contain';
}

/**
 * Error thrown when the input is not a valid ZIP/PPTX file.
 */
export declare class InvalidFileError extends PPTXError {
    constructor(message?: string);
}

/**
 * Type guard to check if an error is a PPTXError.
 */
export declare function isPPTXError(error: unknown): error is PPTXError;

/**
 * Quick check if a file is a valid PPTX.
 *
 * @param archive - Extracted archive to check
 * @returns True if the archive appears to be a valid PPTX
 */
export declare function isValidPPTX(archive: PPTXArchive): boolean;

/**
 * Holds a loaded presentation and its archive for cleanup.
 */
export declare interface LoadedPresentation extends Presentation {
    /**
     * Cleans up resources (blob URLs for images).
     * Call this when you're done with the presentation.
     */
    cleanup: () => void;
}

/**
 * Loads and parses a PPTX file in one step.
 *
 * @param source - PPTX file as File, ArrayBuffer, Uint8Array, or URL string
 * @returns Parsed presentation with cleanup function
 *
 * @example
 * ```typescript
 * import { loadPresentation } from 'pptx-viewer';
 *
 * // From file input
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', async (e) => {
 *   const file = e.target.files[0];
 *   const presentation = await loadPresentation(file);
 *
 *   console.log(`Loaded ${presentation.slides.length} slides`);
 *
 *   // When done, clean up blob URLs
 *   presentation.cleanup();
 * });
 *
 * // From URL
 * const presentation = await loadPresentation('/path/to/file.pptx');
 * ```
 */
export declare function loadPresentation(source: File | ArrayBuffer | Uint8Array | string): Promise<LoadedPresentation>;

/**
 * Error thrown when a required file is missing from the archive.
 */
export declare class MissingFileError extends PPTXError {
    readonly filePath: string;
    constructor(filePath: string);
}

export declare interface NoFill {
    type: 'none';
}

/**
 * A paragraph containing text runs.
 */
export declare interface Paragraph {
    /** Text runs with consistent formatting */
    runs: TextRun[];
    /** Paragraph alignment */
    align?: 'left' | 'center' | 'right' | 'justify';
    /** Line spacing multiplier */
    lineSpacing?: number;
    /** Space before paragraph in pixels */
    spaceBefore?: number;
    /** Space after paragraph in pixels */
    spaceAfter?: number;
    /** Bullet point style */
    bullet?: BulletStyle;
    /** Indentation level (for lists) */
    level?: number;
    /** Left margin in pixels */
    marginLeft?: number;
    /** First line indent (negative for hanging indent) */
    indent?: number;
}

/**
 * Parses a PPTX archive into a Presentation object.
 *
 * @param archive - Extracted PPTX archive
 * @returns Parsed presentation
 * @throws Error if the archive is not a valid PPTX file
 *
 * @example
 * const archive = await extractPPTX(file);
 * const presentation = await parsePPTX(archive);
 * console.log(`${presentation.slides.length} slides`);
 */
export declare function parsePPTX(archive: PPTXArchive): Promise<Presentation>;

export declare interface PatternFill {
    type: 'pattern';
    /** Pattern preset name */
    pattern: PatternType;
    /** Foreground color */
    foreground: Color;
    /** Background color */
    background: Color;
}

/**
 * Pattern fill types from OOXML.
 */
export declare type PatternType = 'pct5' | 'pct10' | 'pct20' | 'pct25' | 'pct30' | 'pct40' | 'pct50' | 'pct60' | 'pct70' | 'pct75' | 'pct80' | 'pct90' | 'horz' | 'vert' | 'ltHorz' | 'ltVert' | 'dkHorz' | 'dkVert' | 'narHorz' | 'narVert' | 'wdHorz' | 'wdVert' | 'dashHorz' | 'dashVert' | 'cross' | 'dnDiag' | 'upDiag' | 'ltDnDiag' | 'ltUpDiag' | 'dkDnDiag' | 'dkUpDiag' | 'wdDnDiag' | 'wdUpDiag' | 'diagCross' | 'smCheck' | 'lgCheck' | 'smGrid' | 'lgGrid' | 'dotGrid' | 'smConfetti' | 'lgConfetti' | 'horzBrick' | 'diagBrick' | 'solidDmnd' | 'openDmnd' | 'dotDmnd' | 'plaid' | 'sphere' | 'weave' | 'divot' | 'shingle' | 'wave' | 'trellis' | 'zigZag';

/**
 * Placeholder information for an element.
 */
export declare interface PlaceholderInfo {
    /** Placeholder type */
    type: PlaceholderType;
    /** Placeholder index (for matching with layout) */
    idx?: number;
}

/**
 * Default text run properties parsed from a master's `txStyles`.
 *
 * OOXML masters define `<p:txStyles>` with three sibling lists —
 * `titleStyle`, `bodyStyle`, and `otherStyle` — each containing per-level
 * paragraph properties whose `<a:defRPr>` carries the default font size,
 * color, weight, etc. for slide-level placeholder runs that don't set
 * their own. Without walking this chain, slide titles end up rendered at
 * the browser's 16-px default in a 2560-unit viewport, which is invisibly
 * small in the viewer.
 *
 * We store one default `TextRun` shape per indentation level (1-9). Index
 * 0 corresponds to lvl1pPr, index 1 to lvl2pPr, etc.
 */
declare interface PlaceholderTextStyles {
    /** Per-level defaults for `titleStyle` (used by `title` and `ctrTitle`). */
    title: Array<Omit<TextRun, 'text'>>;
    /** Per-level defaults for `bodyStyle` (used by `body`, `subTitle`). */
    body: Array<Omit<TextRun, 'text'>>;
    /** Per-level defaults for `otherStyle` (used by everything else). */
    other: Array<Omit<TextRun, 'text'>>;
}

/**
 * Placeholder type from OOXML ph@type attribute.
 */
export declare type PlaceholderType = 'ctrTitle' | 'title' | 'body' | 'subTitle' | 'dt' | 'ftr' | 'sldNum' | 'hdr' | 'pic' | 'chart' | 'tbl' | 'dgm' | 'media' | 'clipArt' | 'obj';

/**
 * Extracted PPTX archive contents.
 */
export declare interface PPTXArchive {
    /** All files in the archive, keyed by path */
    files: Map<string, Uint8Array>;
    /**
     * Gets a file's content as a string (UTF-8).
     * @param path - File path within the archive
     * @returns File content as string, or null if not found
     */
    getText(path: string): string | null;
    /**
     * Gets a file's content as raw bytes.
     * @param path - File path within the archive
     * @returns File content as Uint8Array, or null if not found
     */
    getBytes(path: string): Uint8Array | null;
    /**
     * Gets a file as a Blob URL (for images/media).
     * @param path - File path within the archive
     * @param mimeType - MIME type for the blob
     * @returns Blob URL, or null if not found
     */
    getBlobUrl(path: string, mimeType: string): string | null;
    /**
     * Lists all files in the archive.
     * @returns Array of file paths
     */
    listFiles(): string[];
    /**
     * Checks if a file exists in the archive.
     * @param path - File path to check
     * @returns True if file exists
     */
    hasFile(path: string): boolean;
    /**
     * Cleans up blob URLs to prevent memory leaks.
     * Should be called when done with the archive.
     */
    cleanup(): void;
}

/**
 * Custom error types for PPTX Viewer.
 *
 * These provide more specific error information for debugging and handling.
 */
/**
 * Base error class for all PPTX Viewer errors.
 */
export declare class PPTXError extends Error {
    constructor(message: string);
}

/**
 * PPTX Viewer - A lightweight PowerPoint viewer for the browser.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const viewer = new PPTXViewer('#container');
 * await viewer.load(file);
 *
 * // With options
 * const viewer = new PPTXViewer('#container', {
 *   initialSlide: 0,
 *   keyboardNavigation: true,
 *   showControls: true,
 *   onSlideChange: (index) => console.log(`Slide ${index + 1}`),
 * });
 * ```
 */
export declare class PPTXViewer {
    private container;
    private options;
    private presentation;
    private archive;
    private currentSlideIndex;
    private slideContainer;
    private controlsContainer;
    private listeners;
    private isFullscreen;
    /**
     * Creates a new PPTX Viewer instance.
     *
     * @param container - CSS selector or HTMLElement to render the viewer into
     * @param options - Viewer configuration options
     *
     * @throws Error if the container is not found
     */
    constructor(container: string | HTMLElement, options?: ViewerOptions);
    /**
     * Loads a PPTX file into the viewer.
     *
     * @param source - The PPTX file to load. Accepts:
     *   - `File` object from file input
     *   - `ArrayBuffer` of PPTX data
     *   - `string` URL to fetch PPTX from
     *
     * @returns Promise that resolves when slides are ready
     *
     * @example
     * ```typescript
     * // From file input
     * const file = inputElement.files[0];
     * await viewer.load(file);
     *
     * // From URL
     * await viewer.load('/presentations/demo.pptx');
     * ```
     */
    load(source: File | ArrayBuffer | string): Promise<void>;
    /**
     * Advances to the next slide.
     *
     * @returns The new slide index, or -1 if already at the last slide
     */
    next(): number;
    /**
     * Goes to the previous slide.
     *
     * @returns The new slide index, or -1 if already at the first slide
     */
    previous(): number;
    /**
     * Goes to a specific slide.
     *
     * @param index - The 0-based slide index
     * @returns True if navigation was successful
     */
    goToSlide(index: number): boolean;
    /**
     * Enters fullscreen presentation mode.
     */
    enterFullscreen(): Promise<void>;
    /**
     * Exits fullscreen mode.
     */
    exitFullscreen(): Promise<void>;
    /**
     * Toggles fullscreen mode.
     */
    toggleFullscreen(): Promise<void>;
    /**
     * Gets the current slide index (0-based).
     */
    getCurrentSlide(): number;
    /**
     * Gets the total number of slides.
     */
    getSlideCount(): number;
    /**
     * Gets the loaded presentation data.
     */
    getPresentation(): Presentation | null;
    /**
     * Registers an event listener.
     *
     * @param event - Event type to listen for
     * @param listener - Callback function
     *
     * @example
     * ```typescript
     * viewer.on('slidechange', (index) => {
     *   console.log(`Now on slide ${index + 1}`);
     * });
     * ```
     */
    on<K extends ViewerEventType>(event: K, listener: EventListener_2<ViewerEvents[K]>): void;
    /**
     * Removes an event listener.
     *
     * @param event - Event type
     * @param listener - Callback function to remove
     */
    off<K extends ViewerEventType>(event: K, listener: EventListener_2<ViewerEvents[K]>): void;
    /**
     * Cleans up the viewer and releases resources.
     * Should be called when the viewer is no longer needed.
     */
    destroy(): void;
    /**
     * Sets up the container structure.
     */
    private setupContainer;
    /**
     * Creates navigation controls.
     */
    private createControls;
    /**
     * Updates the controls state.
     */
    private updateControls;
    /**
     * Renders the current slide.
     */
    private renderCurrentSlide;
    /**
     * Sets up keyboard navigation.
     */
    private setupKeyboardNavigation;
    /**
     * Handles keyboard events.
     */
    private handleKeydown;
    /**
     * Handles fullscreen change events.
     */
    private handleFullscreenChange;
    /**
     * Emits an event to listeners.
     */
    private emit;
    /**
     * Emits a slide change event.
     */
    private emitSlideChange;
}

/**
 * Core type definitions for the PPTX Viewer library.
 * These types represent the parsed structure of a PPTX presentation.
 */
/**
 * Represents a complete parsed PPTX presentation.
 */
export declare interface Presentation {
    /** Presentation metadata */
    metadata: PresentationMetadata;
    /** Slide dimensions in pixels */
    slideSize: Size;
    /** All slides in presentation order */
    slides: Slide[];
    /** Theme information (colors, fonts) */
    theme: Theme;
    /** Slide masters indexed by relationship ID */
    slideMasters: Map<string, SlideMaster>;
    /** Slide layouts indexed by relationship ID */
    slideLayouts: Map<string, SlideLayout>;
    /** Embedded fonts extracted from the presentation */
    fonts: Map<string, EmbeddedFont>;
}

/**
 * Presentation metadata extracted from docProps.
 */
export declare interface PresentationMetadata {
    title?: string;
    author?: string;
    createdAt?: string;
    modifiedAt?: string;
}

/**
 * Renders a chart element to SVG.
 */
export declare function renderChart(chart: ChartElement, options?: Partial<ChartRenderOptions>): SVGGElement;

/**
 * Renders a slide element to SVG.
 *
 * @param element - The element to render
 * @param defs - SVG defs element for gradients/patterns
 * @returns SVG element group
 */
export declare function renderElement(element: SlideElement, defs: SVGDefsElement): SVGGElement;

/**
 * Error thrown when rendering fails.
 */
export declare class RenderError extends PPTXError {
    readonly slideIndex?: number;
    readonly elementId?: string;
    constructor(message: string, slideIndex?: number, elementId?: string);
}

/**
 * Renders a slide to an SVG element.
 *
 * @param slide - The slide to render
 * @param slideSize - Original slide dimensions
 * @param options - Rendering options
 * @returns SVG element containing the rendered slide
 */
export declare function renderSlide(slide: Slide, slideSize: Size, options?: SlideRenderOptions): SVGSVGElement;

/**
 * Renders a slide thumbnail (smaller, simplified).
 *
 * @param slide - The slide to render
 * @param slideSize - Original slide dimensions
 * @param thumbnailWidth - Target thumbnail width
 * @returns SVG element
 */
export declare function renderSlideThumbnail(slide: Slide, slideSize: Size, thumbnailWidth: number): SVGSVGElement;

/**
 * Renders a slide to a canvas element.
 * Useful for generating thumbnails or when you need raster output.
 *
 * @param presentation - Loaded presentation
 * @param slideIndex - 0-based slide index
 * @param canvas - Canvas element to render into
 * @returns Promise that resolves when rendering is complete
 *
 * @example
 * ```typescript
 * import { loadPresentation, renderSlideToCanvas } from 'pptx-viewer';
 *
 * const presentation = await loadPresentation(file);
 * const canvas = document.getElementById('thumbnail') as HTMLCanvasElement;
 * canvas.width = 320;
 * canvas.height = 240;
 *
 * await renderSlideToCanvas(presentation, 0, canvas);
 * ```
 */
export declare function renderSlideToCanvas(presentation: Presentation, slideIndex: number, canvas: HTMLCanvasElement): Promise<void>;

/**
 * Renders a slide directly into a container element.
 *
 * @param presentation - Loaded presentation
 * @param slideIndex - 0-based slide index
 * @param container - HTML element to render into
 * @param options - Optional width/height overrides
 *
 * @example
 * ```typescript
 * import { loadPresentation, renderSlideToElement } from 'pptx-viewer';
 *
 * const presentation = await loadPresentation(file);
 * const container = document.getElementById('slide-container');
 *
 * // Render first slide
 * renderSlideToElement(presentation, 0, container);
 *
 * // Render with custom size
 * renderSlideToElement(presentation, 0, container, { width: 800 });
 * ```
 */
export declare function renderSlideToElement(presentation: Presentation, slideIndex: number, container: HTMLElement, options?: {
    width?: number;
    height?: number;
}): void;

/**
 * Renders a slide with full master/layout inheritance.
 *
 * This function implements proper layering:
 * 1. Background (resolved from slide → layout → master)
 * 2. Master shapes (if showMasterShapes is true)
 * 3. Layout shapes (non-placeholder elements)
 * 4. Slide content
 *
 * @param slide - The slide to render
 * @param slideSize - Original slide dimensions
 * @param layout - Optional slide layout
 * @param master - Optional slide master
 * @param options - Rendering options
 * @returns SVG element containing the rendered slide
 */
export declare function renderSlideWithInheritance(slide: Slide, slideSize: Size, layout?: SlideLayout, master?: SlideMaster, options?: SlideRenderOptions): SVGSVGElement;

/**
 * Shadow effect.
 */
export declare interface Shadow {
    /** Shadow type */
    type: 'outer' | 'inner';
    /** Shadow color */
    color: Color;
    /** Blur radius in pixels */
    blurRadius: number;
    /** Distance from shape in pixels */
    distance: number;
    /** Angle in degrees (0 = right, 90 = down) */
    angle: number;
}

/**
 * A shape element (rectangle, ellipse, custom path, etc.).
 */
export declare interface ShapeElement extends BaseElement {
    type: 'shape';
    /** Shape geometry type */
    shapeType: ShapeType;
    /** Fill style */
    fill?: Fill;
    /** Stroke/outline style */
    stroke?: Stroke;
    /** Shadow effect */
    shadow?: Shadow;
    /** Text content inside the shape */
    text?: TextBody;
    /** Custom geometry path (for freeform shapes) */
    path?: string;
    /** Shape adjustment values (e.g., corner radius for rounded rectangles) */
    adjustments?: Map<string, number>;
    /** Horizontal flip */
    flipH?: boolean;
    /** Vertical flip */
    flipV?: boolean;
}

/**
 * Common shape types supported by PPTX.
 */
export declare type ShapeType = 'rect' | 'roundRect' | 'snip1Rect' | 'snip2Rect' | 'ellipse' | 'triangle' | 'rtTriangle' | 'diamond' | 'parallelogram' | 'trapezoid' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon' | 'decagon' | 'dodecagon' | 'star4' | 'star5' | 'star6' | 'star8' | 'star10' | 'star12' | 'arrow' | 'leftArrow' | 'rightArrow' | 'upArrow' | 'downArrow' | 'leftRightArrow' | 'upDownArrow' | 'chevron' | 'homePlate' | 'notchedRightArrow' | 'wedgeRectCallout' | 'wedgeRoundRectCallout' | 'wedgeEllipseCallout' | 'cloudCallout' | 'cube' | 'can' | 'lightningBolt' | 'heart' | 'sun' | 'moon' | 'cloud' | 'arc' | 'donut' | 'noSmoking' | 'blockArc' | 'foldedCorner' | 'frame' | 'halfFrame' | 'corner' | 'plus' | 'cross' | 'line' | 'bentConnector3' | 'curvedConnector3' | 'custom';

/**
 * Width and height dimensions.
 */
export declare interface Size {
    width: number;
    height: number;
}

/**
 * Represents a single slide in the presentation.
 */
export declare interface Slide {
    /** Slide index (0-based) */
    index: number;
    /** Slide background */
    background?: Background;
    /** All elements on the slide */
    elements: SlideElement[];
    /** Notes for this slide */
    notes?: string;
    /** Layout relationship ID (for inheritance) */
    layoutId?: string;
}

/**
 * Union type of all possible slide elements.
 */
export declare type SlideElement = ShapeElement | TextElement | ImageElement | GroupElement | TableElement | ChartElement | DiagramElement;

/**
 * Represents a slide layout.
 * Layouts define placeholder positions and can override master properties.
 */
export declare interface SlideLayout {
    /** Layout relationship ID */
    id: string;
    /** Layout name */
    name?: string;
    /** Layout type (e.g., "title", "obj", "twoObj") */
    type?: string;
    /** Parent master relationship ID */
    masterId: string;
    /** Background override (if different from master) */
    background?: Background;
    /** Layout-specific elements and placeholders */
    elements: SlideElement[];
    /** Whether to show master shapes on slides using this layout */
    showMasterShapes: boolean;
    /** Color map overrides */
    colorMap?: ColorMap;
}

/**
 * Represents a slide master.
 * Masters define the base styling for all slides using them.
 */
export declare interface SlideMaster {
    /** Master relationship ID */
    id: string;
    /** Master name */
    name?: string;
    /** Master background */
    background?: Background;
    /** Master-level elements (logos, decorations visible on all slides) */
    elements: SlideElement[];
    /** Color mapping for this master */
    colorMap: ColorMap;
    /** Associated layout relationship IDs */
    layoutIds: string[];
    /**
     * Default text run properties from `<p:txStyles>`. Used to fill in
     * missing `fontSize`/`color`/etc. on slide placeholder runs that inherit
     * everything from the master.
     */
    textStyles?: PlaceholderTextStyles;
}

/**
 * Options for rendering a slide.
 */
declare interface SlideRenderOptions {
    /** Target width (will scale proportionally) */
    width?: number;
    /** Target height (will scale proportionally) */
    height?: number;
}

export declare interface SolidFill {
    type: 'solid';
    color: Color;
}

/**
 * Stroke/outline style.
 */
export declare interface Stroke {
    color: Color;
    /** Width in pixels */
    width: number;
    /** Dash pattern */
    dashStyle?: 'solid' | 'dash' | 'dot' | 'dashDot';
    /** Arrow head at start of line */
    headEnd?: ArrowHead;
    /** Arrow head at end of line */
    tailEnd?: ArrowHead;
}

/**
 * A cell in a table.
 */
export declare interface TableCell {
    /** Text content */
    text?: TextBody;
    /** Cell fill */
    fill?: Fill;
    /** Cell borders */
    borders?: CellBorders;
    /** Number of columns this cell spans */
    colSpan?: number;
    /** Number of rows this cell spans */
    rowSpan?: number;
    /** Vertical alignment */
    verticalAlign?: 'top' | 'middle' | 'bottom';
}

/**
 * A table element.
 */
export declare interface TableElement extends BaseElement {
    type: 'table';
    /** Table rows */
    rows: TableRow[];
    /** Column widths in pixels */
    columnWidths: number[];
    /** Table-level styling */
    style?: TableStyle;
}

/**
 * A row in a table.
 */
export declare interface TableRow {
    /** Row height in pixels */
    height: number;
    /** Cells in this row */
    cells: TableCell[];
}

/**
 * Table-level styling.
 */
export declare interface TableStyle {
    /** First row has special styling */
    firstRow?: boolean;
    /** Last row has special styling */
    lastRow?: boolean;
    /** First column has special styling */
    firstCol?: boolean;
    /** Last column has special styling */
    lastCol?: boolean;
    /** Alternating row bands */
    bandRow?: boolean;
    /** Alternating column bands */
    bandCol?: boolean;
}

/**
 * Text autofit settings for shrinking text to fit container.
 */
export declare interface TextAutofit {
    /** Type of autofit */
    type: 'normal' | 'shape' | 'none';
    /** Font scale as decimal (e.g., 0.925 = 92.5%) */
    fontScale?: number;
    /** Line spacing reduction as decimal (e.g., 0.1 = 10% reduction) */
    lineSpacingReduction?: number;
}

/**
 * Text body containing paragraphs.
 */
export declare interface TextBody {
    paragraphs: Paragraph[];
    /** Vertical alignment */
    verticalAlign?: 'top' | 'middle' | 'bottom';
    /** Text padding/margins */
    padding?: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /** Text autofit settings */
    autofit?: TextAutofit;
}

/**
 * A standalone text element (text box).
 */
export declare interface TextElement extends BaseElement {
    type: 'text';
    /** Text content and formatting */
    text: TextBody;
    /** Fill style for text box background */
    fill?: Fill;
    /** Stroke for text box border */
    stroke?: Stroke;
    /** Shadow effect */
    shadow?: Shadow;
}

/**
 * Text glow effect.
 */
export declare interface TextGlow {
    /** Glow radius in pixels */
    radius: number;
    /** Glow color */
    color: Color;
}

/**
 * Text outline/stroke style.
 */
export declare interface TextOutline {
    /** Outline color */
    color: Color;
    /** Outline width in pixels */
    width: number;
}

/**
 * Text reflection effect.
 */
export declare interface TextReflection {
    /** Blur radius in pixels */
    blurRadius: number;
    /** Start opacity (0-1) */
    startOpacity: number;
    /** End opacity (0-1) */
    endOpacity: number;
    /** Distance from text in pixels */
    distance: number;
    /** Direction angle in degrees */
    direction: number;
    /** Fade direction angle in degrees */
    fadeDirection: number;
    /** Vertical scaling (percentage, e.g., 100 = 100%) */
    scaleY: number;
    /** Horizontal skew angle in degrees */
    skewX: number;
    /** Vertical alignment */
    align: 'top' | 'bottom';
}

/**
 * A run of text with consistent formatting.
 */
export declare interface TextRun {
    /** The text content */
    text: string;
    /** Font family */
    fontFamily?: string;
    /** Font size in pixels */
    fontSize?: number;
    /** Font color */
    color?: Color;
    /** Bold */
    bold?: boolean;
    /** Italic */
    italic?: boolean;
    /** Underline */
    underline?: boolean;
    /** Strikethrough */
    strikethrough?: boolean;
    /** Baseline offset as percentage (positive = superscript, negative = subscript) */
    baseline?: number;
    /** Hyperlink URL */
    link?: string;
    /** Character spacing in pixels (can be negative for tighter spacing) */
    characterSpacing?: number;
    /** Text capitalization */
    capitalization?: 'none' | 'allCaps' | 'smallCaps';
    /** Text highlight/background color */
    highlight?: Color;
    /** Glow effect */
    glow?: TextGlow;
    /** Reflection effect */
    reflection?: TextReflection;
    /** Text outline/stroke */
    outline?: TextOutline;
}

/**
 * Presentation theme with colors and fonts.
 */
export declare interface Theme {
    /** Theme name */
    name?: string;
    /** Color scheme */
    colors: ThemeColors;
    /** Font scheme */
    fonts: ThemeFonts;
}

/**
 * Theme color palette.
 */
export declare interface ThemeColors {
    /** Dark 1 (usually background) */
    dark1: string;
    /** Light 1 (usually text) */
    light1: string;
    /** Dark 2 */
    dark2: string;
    /** Light 2 */
    light2: string;
    /** Accent colors 1-6 */
    accent1: string;
    accent2: string;
    accent3: string;
    accent4: string;
    accent5: string;
    accent6: string;
    /** Hyperlink color */
    hlink: string;
    /** Followed hyperlink color */
    folHlink: string;
}

/**
 * Theme font definitions.
 */
export declare interface ThemeFonts {
    /** Major font (headings) */
    major: string;
    /** Minor font (body text) */
    minor: string;
}

/**
 * Events emitted by the viewer.
 */
export declare interface ViewerEvents {
    slidechange: number;
    load: Presentation;
    error: Error;
    fullscreenchange: boolean;
}

export declare type ViewerEventType = keyof ViewerEvents;

/**
 * Configuration options for the PPTX Viewer.
 */
export declare interface ViewerOptions {
    /** Initial slide index (0-based) */
    initialSlide?: number;
    /** Enable keyboard navigation */
    keyboardNavigation?: boolean;
    /** Show slide navigation controls */
    showControls?: boolean;
    /** Custom width (defaults to container width) */
    width?: number;
    /** Custom height (defaults to maintain aspect ratio) */
    height?: number;
    /** Callback when slide changes */
    onSlideChange?: (index: number) => void;
    /** Callback when presentation loads */
    onLoad?: (presentation: Presentation) => void;
    /** Callback on error */
    onError?: (error: Error) => void;
}

/**
 * Error thrown when XML parsing fails.
 */
export declare class XMLParseError extends PPTXError {
    readonly filePath?: string;
    constructor(message: string, filePath?: string);
}

export { }
