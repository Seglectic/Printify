# ╭──────────────────────────╮
# │  printChan               │
# │  Helper script to send   │
# │  image data to Printify  │
# ╰──────────────────────────╯
import requests
import argparse

# Parse command line arguments
def parseArgs():
    parser = argparse.ArgumentParser(description="Helper script to send image data to Printify")
    parser.add_argument('-f', '--filepath', help="Filepath of the image to send", required=True)
    parser.add_argument('-e', '--endpoint', help="Endpoint to send the image data to", default='/zebrapng')
    parser.add_argument('-u', '--url',      help="URL of the server", default='http://192.168.1.18')
    parser.add_argument('-t', '--endType',  help="Type of endpoint to send the image data to", default='pngFile')
    return parser.parse_args()

def main():
  args = parseArgs()
  url = args.url + args.endpoint
  filePath = args.filepath
  endPointType = args.endType
  with open(filePath, 'rb') as file:           # Open the file in bin mode
    files = {'pngFile': file}                  # Key must be the same as the endpoint expects
    res = requests.post(url, files=files)      # Send the file
    if res.status_code == 200:
      print('File successfully uploaded.')
    else:
      print('Error uploading file:', res.text)


if __name__ == '__main__':
    main()