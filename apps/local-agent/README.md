# @pocket-agent/local-agent

PC-side service. It connects outbound to the API over WSS, ingests Claude Code hooks on 127.0.0.1, and runs managed
sessions through provider modules (`src/providers/<name>/`). It never exposes anything on a public interface.
