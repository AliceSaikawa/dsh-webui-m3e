/** A supported Node test reporter: only the final cumulative summary is a report. */
export default async function* summaryReporter(source: AsyncIterable<{
  type: string
  data: { file?: string; [key: string]: unknown }
}>) {
  for await (const event of source) {
    if (event.type === 'test:summary' && event.data.file === undefined) {
      yield JSON.stringify(event.data) + '\n'
    }
  }
}
