import React from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface FormattedApplyLogsProps {
  logText: string;
}

interface LogObject {
  [key: string]: any;
  type?: string;
  "@level"?: string;
  "@message"?: string;
}

// Helper function to truncate text to a given limit
const truncate = (str: string, limit = 50): string => {
  return str.length > limit ? str.substring(0, limit) + "..." : str;
};

const FormattedApplyLogs: React.FC<FormattedApplyLogsProps> = ({ logText }) => {
  const logLines = logText
    .split("\n")
    .filter((line) => line.trim() !== "");

  const parsedLogs: LogObject[] = logLines.reduce<LogObject[]>((acc, line) => {
    try {
      const obj: LogObject = JSON.parse(line);
      acc.push(obj);
    } catch (err) {
      console.error("Unable to parse log line:", line, err);
    }
    return acc;
  }, []);

  const outputs = parsedLogs.filter((obj) => obj.type === "outputs");
  const otherLogs = parsedLogs.filter((obj) => obj.type !== "outputs");

  return (
    <Box sx={{ my: 2 }}>
      {otherLogs.map((log, index) => {
        const summary = `Log ${index + 1} – ${log["@level"]} – ${log["@message"] || ""}`;
        return (
          <Accordion key={index} sx={{ wordBreak: "break-word" }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">
                {truncate(summary, 50)}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box
                component="pre"
                sx={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: 'monospace',
                  m: 0,
                }}
              >
                {JSON.stringify(log, null, 2)}
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}

      {outputs.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h5" gutterBottom>
            Outputs
          </Typography>
          {outputs.map((out, idx) => (
            <Accordion key={`output-${idx}`} defaultExpanded sx={{ wordBreak: "break-word" }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1">
                  {truncate(`Output Log ${idx + 1}`, 150)}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box
                  component="pre"
                  sx={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: 'monospace',
                    m: 0,
                  }}
                >
                  {JSON.stringify(out, null, 2)}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default FormattedApplyLogs;
