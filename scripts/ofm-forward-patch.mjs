// Reproducible stream diagnostics patch; routing, authorization and replies are unchanged.
export function patchStreamFailure(source) {
  const before = `      } else {
        res.end()
      }
    })
  })`;
  const after = `      } else if (!res.writableEnded) {
        // The stream already started: say why it stops, or the caller only
        // sees a stream cut short with no reason.
        try {
          res.write(\`data: \${JSON.stringify({ error: { message: String(error?.message ?? error), type: 'server_error' } })}\\n\\n\`)
        } catch {}
        res.end()
      }
    })
  })`;
  if (source.split(before).length !== 2) throw new Error('Upstream forward stream failure handling changed');
  return source.replace(before, after);
}
