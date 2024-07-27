
# Screen Recording Annotator

The **Screen Recording Annotator** is a web application that allows users to upload screen recording videos, extract key frames, and annotate selected frames. Users can draw on the frames and add text annotations, including support for Markdown formatting. The annotated frames can be exported to a PDF document.

## Features

- **Video Upload:** Upload screen recording videos via drag-and-drop or file selection.
- **Frame Extraction:** Automatically extracts frames from the video at regular intervals.
- **Key Frame Selection:** Automatically identifies key frames based on pixel differences.
- **Annotation Tools:** 
  - Draw on frames with a customizable brush.
  - Add text annotations, with support for Markdown formatting.
- **Export to PDF:** Export selected annotated frames and their annotations to a PDF.

## Usage

### 1. Upload a Video
- Drag and drop a video file into the designated area or click to select a file.

### 2. Extract and Select Key Frames
- The application extracts frames from the uploaded video. Key frames are displayed below the video.
- Click on any key frame to select it for annotation.

### 3. Annotate Selected Frame
- **Drawing:** Use the mouse or touch to draw on the canvas.
- **Text Annotation:** Add text annotations in the text area. Markdown syntax can be used for styling. The text area will appear when a key frame is selected.
- **Selection and Export:** Frames can be selected for export by checking the checkbox on the top left corner of each frame.

### 4. Export Annotations
- Click the "Export Annotations to PDF" button to download a PDF containing the annotated frames and their annotations.

## Technologies Used

- **HTML5 & CSS3:** For structuring and styling the application.
- **JavaScript (ES6):** For the application logic and interactivity.
- **Canvas API:** For rendering video frames and drawing annotations.
- **jsPDF:** For generating PDF documents from the annotations.
- **html2canvas:** For capturing annotated frames as images.
- **markdown-it:** For rendering Markdown text into HTML.
- **DOMPurify:** For sanitizing HTML content.

## Setup and Development

To set up the project locally:

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd screen-recording-annotator
   ```

2. Open the `index.html` file in your browser to run the application locally.

### Development Tools

- **Visual Studio Code**: Recommended for editing HTML, CSS, and JavaScript files.
- **Browser Developer Tools**: Useful for debugging and inspecting the DOM.

## Working Example

Check out a working example of the project at: [Screen Recording Annotator](https://derekg.github.io/annotate/)

## Contribution

Contributions are welcome! Please feel free to submit a pull request or open an issue to discuss any changes or improvements.


## Acknowledgments

- **Libraries Used:** Thanks to the creators of jsPDF, html2canvas, markdown-it, and DOMPurify for their valuable libraries.
