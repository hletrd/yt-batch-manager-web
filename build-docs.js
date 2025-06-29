const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const htmlTemplate = (title, content, description = '') => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - YT Batch Manager</title>
    <meta name="description" content="${description}">
    <meta name="author" content="Jiyong Youn">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #24292f;
            max-width: 1012px;
            margin: 0 auto;
            padding: 16px;
            background-color: #ffffff;
        }

        .container {
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            padding: 16px 32px;
            margin: 16px 0;
        }

        h1, h2, h3, h4, h5, h6 {
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
        }

        h1 {
            padding-bottom: 0.3em;
            border-bottom: 1px solid #d0d7de;
            font-size: 2em;
        }

        h2 {
            padding-bottom: 0.3em;
            border-bottom: 1px solid #d0d7de;
            font-size: 1.5em;
        }

        p {
            margin-top: 0;
            margin-bottom: 16px;
        }

        a {
            color: #0969da;
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        }

        code {
            padding: 0.2em 0.4em;
            margin: 0;
            font-size: 85%;
            background-color: rgba(175,184,193,0.2);
            border-radius: 6px;
        }

        pre {
            padding: 16px;
            overflow: auto;
            background-color: #f6f8fa;
            border-radius: 6px;
            border: 1px solid #d0d7de;
        }

        pre code {
            background-color: transparent;
            border: 0;
            padding: 0;
            margin: 0;
        }

        blockquote {
            padding: 0 1em;
            color: #656d76;
            border-left: 0.25em solid #d0d7de;
            margin: 0 0 16px 0;
        }

        table {
            border-spacing: 0;
            border-collapse: collapse;
            width: 100%;
            margin: 16px 0;
        }

        table th,
        table td {
            padding: 6px 13px;
            border: 1px solid #d0d7de;
        }

        table th {
            font-weight: 600;
            background-color: #f6f8fa;
        }

        ul, ol {
            padding-left: 2em;
        }

        li {
            margin: 0.25em 0;
        }

        .back-link {
            margin-bottom: 24px;
            padding: 8px 16px;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            display: inline-block;
        }

        .disclaimer {
            background-color: #fff8e1;
            border-left: 4px solid #ff9800;
            padding: 16px;
            margin: 16px 0;
            border-radius: 0 6px 6px 0;
        }

        .privacy-note {
            background-color: #e8f4fd;
            border-left: 4px solid #0969da;
            padding: 16px;
            margin: 16px 0;
            border-radius: 0 6px 6px 0;
        }

        hr {
            height: 0.25em;
            padding: 0;
            margin: 24px 0;
            background-color: #d0d7de;
            border: 0;
        }

        @media (max-width: 768px) {
            body {
                padding: 8px;
            }

            .container {
                padding: 16px;
            }
        }

        @media (prefers-color-scheme: dark) {
            body {
                background-color: #0d1117;
                color: #e6edf3;
            }

            .container {
                background-color: #161b22;
                border-color: #30363d;
            }

            h1, h2 {
                border-bottom-color: #30363d;
            }

            a {
                color: #58a6ff;
            }

            code {
                background-color: rgba(110,118,129,0.4);
            }

            pre {
                background-color: #161b22;
                border-color: #30363d;
            }

            blockquote {
                color: #8b949e;
                border-left-color: #30363d;
            }

            table th,
            table td {
                border-color: #30363d;
            }

            table th {
                background-color: #161b22;
            }

            .back-link {
                background-color: #161b22;
                border-color: #30363d;
            }

            .disclaimer {
                background-color: #332b00;
                border-left-color: #d29922;
            }

            .privacy-note {
                background-color: #0c2d6b;
                border-left-color: #1f6feb;
            }

            hr {
                background-color: #30363d;
            }

            footer {
                border-top-color: #30363d;
                color: #8b949e;
            }
        }
    </style>
</head>
<body>
    <div class="back-link">
        <a href="../">← Back to YT Batch Manager</a>
    </div>

    <div class="container">
        ${content}
    </div>

    <footer style="text-align: center; margin-top: 32px; padding: 16px; border-top: 1px solid #d0d7de; color: #656d76;">
        <p>&copy; ${new Date().getFullYear()} Jiyong Youn. Licensed under GPL-3.0-or-later.</p>
        <p>YouTube is a registered trademark of Google LLC. This project is not affiliated with YouTube.</p>
    </footer>
</body>
</html>`;

function buildDocs() {
  const distDir = path.join(__dirname, 'dist');

  const readmePath = path.join(__dirname, 'README.md');
  const privacyPath = path.join(__dirname, 'PRIVACY.md');

  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    const readmeHtml = marked(readmeContent);
    const readmeFullHtml = htmlTemplate(
      'About',
      readmeHtml,
      'YT Batch Manager - Edit YouTube video titles and descriptions in a single page'
    );

    fs.writeFileSync(path.join(distDir, 'about.html'), readmeFullHtml);
    console.log('Generated dist/about.html from README.md');
  }

  if (fs.existsSync(privacyPath)) {
    const privacyContent = fs.readFileSync(privacyPath, 'utf8');
    const privacyHtml = marked(privacyContent);
    const privacyFullHtml = htmlTemplate(
      'Privacy Policy',
      privacyHtml,
      'Privacy Policy for YT Batch Manager - How we handle your data and privacy'
    );

    fs.writeFileSync(path.join(distDir, 'privacy.html'), privacyFullHtml);
    console.log('Generated dist/privacy.html from PRIVACY.md');
  }
}

if (require.main === module) {
  buildDocs();
}

module.exports = { buildDocs };