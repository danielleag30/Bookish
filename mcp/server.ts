#!/usr/bin/env -S npx tsx
/**
 * Bookish MCP server — a spoiler-bounded view of the character graphs.
 *
 *   Claude Desktop config:
 *     { "mcpServers": { "bookish": {
 *         "command": "npx",
 *         "args": ["tsx", "/absolute/path/to/Bookish/mcp/server.ts"] } } }
 *
 * The tools are in tools.ts; this file is transport and declaration only. Every
 * one of them reads through gate(), so the reading position is enforced in the
 * data layer rather than by asking a model to behave.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  loadSeries, newState, listSeries, setReadingPosition, searchCharacters,
  getCharacter, getRelationships, getEvents, findConnection, ToolError,
} from './tools.ts';

const all = loadSeries();
const state = newState();

const server = new Server(
  { name: 'bookish', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const seriesArg = {
  type: 'string' as const,
  description: `Series id. One of: ${[...all.keys()].join(', ')}`,
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_series',
      description:
        'List the available series and where the reader currently is in each. ' +
        'Call this first to see what exists.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'set_reading_position',
      description:
        'Set how far the reader has read in a series. Everything else is bounded ' +
        'by this: characters, relationships, events and biographies that arrive ' +
        'later are not returned by any tool. Defaults to book 1 until set.',
      inputSchema: {
        type: 'object',
        properties: {
          series: seriesArg,
          book: { type: 'number', description: 'Book number, starting at 1' },
        },
        required: ['series', 'book'],
      },
    },
    {
      name: 'search_characters',
      description:
        'Find characters by name or role. Only returns characters the reader has ' +
        'already met.',
      inputSchema: {
        type: 'object',
        properties: { series: seriesArg, query: { type: 'string' } },
        required: ['series', 'query'],
      },
    },
    {
      name: 'get_character',
      description:
        'Details for one character as the reader currently understands them. A ' +
        'character the reader wrongly believes to be dead is reported dead, and ' +
        'biographies are withheld until the final book because they describe the ' +
        'whole series.',
      inputSchema: {
        type: 'object',
        properties: { series: seriesArg, id: { type: 'string', description: 'Character id or name' } },
        required: ['series', 'id'],
      },
    },
    {
      name: 'get_relationships',
      description:
        "A character's relationships, optionally filtered to one type. Searches " +
        'both directions, so it finds edges pointing at the character as well as ' +
        'away from them.',
      inputSchema: {
        type: 'object',
        properties: {
          series: seriesArg,
          id: { type: 'string' },
          type: { type: 'string', description: 'Optional: bonded, family, romantic, enemy, …' },
        },
        required: ['series', 'id'],
      },
    },
    {
      name: 'get_events',
      description:
        'Plot events up to the reading position. Pass a character to get only ' +
        'the events they were part of — this answers "what happened to X?".',
      inputSchema: {
        type: 'object',
        properties: { series: seriesArg, character: { type: 'string' } },
        required: ['series'],
      },
    },
    {
      name: 'find_connection',
      description:
        'Shortest relationship path between two characters, through characters ' +
        'the reader has already met.',
      inputSchema: {
        type: 'object',
        properties: { series: seriesArg, from: { type: 'string' }, to: { type: 'string' } },
        required: ['series', 'from', 'to'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as Record<string, string | number>;
  const s = String(a['series'] ?? '');
  try {
    let text: string;
    switch (req.params.name) {
      case 'list_series': text = listSeries(all, state); break;
      case 'set_reading_position':
        text = setReadingPosition(all, state, s, Number(a['book'])); break;
      case 'search_characters':
        text = searchCharacters(all, state, s, String(a['query'])); break;
      case 'get_character':
        text = getCharacter(all, state, s, String(a['id'])); break;
      case 'get_relationships':
        text = getRelationships(all, state, s, String(a['id']),
          a['type'] ? String(a['type']) : undefined); break;
      case 'get_events':
        text = getEvents(all, state, s, a['character'] ? String(a['character']) : undefined); break;
      case 'find_connection':
        text = findConnection(all, state, s, String(a['from']), String(a['to'])); break;
      default:
        throw new ToolError(`unknown tool ${req.params.name}`);
    }
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: err instanceof ToolError ? err.message : `tool failed: ${String(err)}`,
      }],
    };
  }
});

await server.connect(new StdioServerTransport());
