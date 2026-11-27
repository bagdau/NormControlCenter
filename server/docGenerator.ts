import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  convertMillimetersToTwip,
} from 'docx';
import PDFDocument from 'pdfkit';
import { LabReportSnapshot } from './types';

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

function cmToTwip(cm: number): number {
  return Math.round(cm * 567);
}

function splitParagraphs(text: string): string[] {
  const clean = text.trim();
  if (!clean) return ['—'];
  return clean.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

export async function generateLabDocxBuffer(
  snapshot: LabReportSnapshot
): Promise<Buffer> {
  const fmt = snapshot.formatting;
  const fontSizeHalfPt = fmt.fontSizePt * 2;
  const lineSpacing240 = Math.round(fmt.lineSpacing * 240);
  const firstLineTwip = cmToTwip(fmt.firstLineIndentCm);
  const hangingTwip = cmToTwip(fmt.hangingIndentCm);

  const pageBorders = fmt.showFrame
    ? {
        pageBorders: {
          pageBorderTop: { style: BorderStyle.SINGLE, size: 6, space: 24, color: '1e3a8a' },
          pageBorderBottom: { style: BorderStyle.SINGLE, size: 6, space: 24, color: '1e3a8a' },
          pageBorderLeft: { style: BorderStyle.SINGLE, size: 6, space: 24, color: '1e3a8a' },
          pageBorderRight: { style: BorderStyle.SINGLE, size: 6, space: 24, color: '1e3a8a' },
        },
      }
    : {};

  const makeHeading = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120, line: lineSpacing240 },
      children: [
        new TextRun({
          text: text.toUpperCase(),
          bold: true,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    });

  const makeBodyParagraphs = (text: string) =>
    splitParagraphs(text).map(
      (line) =>
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          indent: { firstLine: firstLineTwip },
          spacing: { after: 80, line: lineSpacing240 },
          children: [
            new TextRun({
              text: line,
              font: fmt.fontFamily,
              size: fontSizeHalfPt,
            }),
          ],
        })
    );

  const titleChildren: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: snapshot.university.toUpperCase(),
          bold: true,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 1400 },
      children: [
        new TextRun({
          text: snapshot.department,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `ЛАБОРАТОРНАЯ РАБОТА №${snapshot.labNumber || '1'}`,
          bold: true,
          font: fmt.fontFamily,
          size: fontSizeHalfPt + 4,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `по дисциплине: ${snapshot.discipline}`,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 1800 },
      children: [
        new TextRun({
          text: `Тема: «${snapshot.title}»`,
          bold: true,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `Выполнил: студент гр. ${snapshot.studentGroup} ${snapshot.studentName}`,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 1800 },
      children: [
        new TextRun({
          text: `Проверил: ${snapshot.teacherName}`,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      pageBreakBefore: false,
      children: [
        new TextRun({
          text: snapshot.cityYear,
          font: fmt.fontFamily,
          size: fontSizeHalfPt,
        }),
      ],
    }),
  ];

  const bodyChildren: Paragraph[] = [
    new Paragraph({ pageBreakBefore: true, children: [] }),
    makeHeading('1 Цель работы'),
    ...makeBodyParagraphs(snapshot.goal),
    makeHeading('2 Инструменты и программная среда'),
    ...makeBodyParagraphs(snapshot.tools),
    makeHeading('3 Ход работы'),
    ...makeBodyParagraphs(snapshot.procedure),
    makeHeading('4 Полученный результат'),
    ...makeBodyParagraphs(snapshot.result),
    makeHeading('5 Вывод'),
    ...makeBodyParagraphs(snapshot.conclusion),
    makeHeading('Список использованных источников'),
    ...(snapshot.sources.length > 0 ? snapshot.sources : ['Источники не указаны']).map(
      (src, idx) =>
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          indent: { left: hangingTwip, hanging: hangingTwip },
          spacing: { after: 60, line: lineSpacing240 },
          children: [
            new TextRun({
              text: `${idx + 1}. ${src}`,
              font: fmt.fontFamily,
              size: fontSizeHalfPt,
            }),
          ],
        })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297),
            },
            margin: {
              top: convertMillimetersToTwip(fmt.marginsMm.top),
              right: convertMillimetersToTwip(fmt.marginsMm.right),
              bottom: convertMillimetersToTwip(fmt.marginsMm.bottom),
              left: convertMillimetersToTwip(fmt.marginsMm.left),
            },
            ...pageBorders,
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${snapshot.discipline} · Шаблон ${snapshot.templateVersion}`,
                    font: fmt.fontFamily,
                    size: 18,
                    color: '666666',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: fmt.showPageNumbers
          ? {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        children: [PageNumber.CURRENT],
                        font: fmt.fontFamily,
                        size: 22,
                      }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        children: [...titleChildren, ...bodyChildren],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

function resolveFontPaths(): { regular: string; bold: string } {
  const localRegular = path.resolve(process.cwd(), 'server/fonts/DejaVuSerif.ttf');
  const localBold = path.resolve(process.cwd(), 'server/fonts/DejaVuSerif-Bold.ttf');
  if (fs.existsSync(localRegular) && fs.existsSync(localBold)) {
    return { regular: localRegular, bold: localBold };
  }
  return {
    regular: '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
  };
}

export async function generateLabPdfBuffer(
  snapshot: LabReportSnapshot
): Promise<Buffer> {
  const fmt = snapshot.formatting;
  const fonts = resolveFontPaths();

  const marginTop = mmToPt(fmt.marginsMm.top);
  const marginRight = mmToPt(fmt.marginsMm.right);
  const marginBottom = mmToPt(fmt.marginsMm.bottom);
  const marginLeft = mmToPt(fmt.marginsMm.left);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: marginTop,
        right: marginRight,
        bottom: marginBottom,
        left: marginLeft,
      },
      bufferPages: true,
      info: {
        Title: snapshot.title,
        Author: snapshot.studentName,
        Subject: `Лабораторная работа №${snapshot.labNumber}`,
        CreationDate: new Date(0),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('SerifReg', fonts.regular);
    doc.registerFont('SerifBold', fonts.bold);

    const drawFrameIfNeeded = () => {
      if (!fmt.showFrame) return;
      doc
        .save()
        .lineWidth(0.75)
        .strokeColor('#1e3a8a')
        .rect(
          marginLeft - 8,
          marginTop - 8,
          doc.page.width - marginLeft - marginRight + 16,
          doc.page.height - marginTop - marginBottom + 16
        )
        .stroke()
        .restore();
    };

    drawFrameIfNeeded();

    // Title Page
    doc.font('SerifBold').fontSize(fmt.fontSizePt);
    doc.text(snapshot.university.toUpperCase(), { align: 'center' });
    doc.moveDown(0.5);
    doc.font('SerifReg').fontSize(fmt.fontSizePt).text(snapshot.department, { align: 'center' });

    doc.moveDown(5);
    doc
      .font('SerifBold')
      .fontSize(fmt.fontSizePt + 2)
      .text(`ЛАБОРАТОРНАЯ РАБОТА №${snapshot.labNumber || '1'}`, { align: 'center' });
    doc.moveDown(0.5);
    doc
      .font('SerifReg')
      .fontSize(fmt.fontSizePt)
      .text(`по дисциплине: ${snapshot.discipline}`, { align: 'center' });
    doc.moveDown(1);
    doc
      .font('SerifBold')
      .fontSize(fmt.fontSizePt)
      .text(`Тема: «${snapshot.title}»`, { align: 'center' });

    doc.moveDown(5);
    doc
      .font('SerifReg')
      .fontSize(fmt.fontSizePt)
      .text(`Выполнил: студент гр. ${snapshot.studentGroup} ${snapshot.studentName}`, {
        align: 'right',
      });
    doc.moveDown(0.3);
    doc.text(`Проверил: ${snapshot.teacherName}`, { align: 'right' });

    doc.y = doc.page.height - marginBottom - 36;
    doc.text(snapshot.cityYear, { align: 'center' });

    // Content Pages
    doc.addPage();
    drawFrameIfNeeded();
    doc.on('pageAdded', drawFrameIfNeeded);

    const lineGap = Math.max(2, fmt.fontSizePt * (fmt.lineSpacing - 1));
    const indentPt = cmToTwip(fmt.firstLineIndentCm) / 20;

    const writeSection = (heading: string, content: string) => {
      doc.moveDown(0.8);
      doc
        .font('SerifBold')
        .fontSize(fmt.fontSizePt)
        .text(heading.toUpperCase(), { align: 'center' });
      doc.moveDown(0.4);
      doc.font('SerifReg').fontSize(fmt.fontSizePt);
      for (const para of splitParagraphs(content)) {
        doc.text(para, {
          align: 'justify',
          indent: indentPt,
          lineGap,
        });
        doc.moveDown(0.25);
      }
    };

    writeSection('1 Цель работы', snapshot.goal);
    writeSection('2 Инструменты и программная среда', snapshot.tools);
    writeSection('3 Ход работы', snapshot.procedure);
    writeSection('4 Полученный результат', snapshot.result);
    writeSection('5 Вывод', snapshot.conclusion);

    doc.moveDown(0.8);
    doc
      .font('SerifBold')
      .fontSize(fmt.fontSizePt)
      .text('СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ', { align: 'center' });
    doc.moveDown(0.4);
    doc.font('SerifReg').fontSize(fmt.fontSizePt);
    const sources = snapshot.sources.length > 0 ? snapshot.sources : ['Источники не указаны'];
    sources.forEach((src, i) => {
      doc.text(`${i + 1}. ${src}`, {
        align: 'justify',
        lineGap,
      });
      doc.moveDown(0.2);
    });

    // Headers and page numbers across buffered pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      const savedTop = doc.page.margins.top;
      doc.page.margins.top = 10;
      doc.page.margins.bottom = 10;

      // Subtle header on content pages
      if (i > 0) {
        doc
          .font('SerifReg')
          .fontSize(9)
          .fillColor('#555555')
          .text(
            `${snapshot.discipline} · Шаблон ${snapshot.templateVersion}`,
            marginLeft,
            18,
            {
              width: doc.page.width - marginLeft - marginRight,
              align: 'right',
            }
          );
      }

      if (fmt.showPageNumbers && i > 0) {
        doc
          .font('SerifReg')
          .fontSize(11)
          .fillColor('#000000')
          .text(
            String(i + 1),
            marginLeft,
            doc.page.height - savedBottom + 10,
            {
              width: doc.page.width - marginLeft - marginRight,
              align: 'center',
            }
          );
      }
      doc.fillColor('#000000');
      doc.page.margins.top = savedTop;
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}
