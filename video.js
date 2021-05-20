"use strict";

function error(message) {
  console.warn("Error: ", message);
}

function debug(message) {
  console.debug("Debug: ", message);
}

let localStream;
let remoteStream;
let channel = "";
let vendorId = "default";
let tokens;

(async () => {
  try {
    const response = await fetch(
      "http://api.homeid.gmar.by:8888/panels-api/v1/auth/tokens",
      {
        method: "POST",
        body: JSON.stringify({ vendor_id: vendorId }),
        headers: {
          "Content-Type": "application/json;charset=utf-8",
        },
      }
    );
    tokens = await response.json();
    init();
  } catch (e) {
    alert("can not make a call");
  }
})();

function generateGuid() {
  var result, i, j;
  result = "";
  for (j = 0; j < 32; j++) {
    if (j == 8 || j == 12 || j == 16 || j == 20) result = result + "-";
    i = Math.floor(Math.random() * 16)
      .toString(16)
      .toUpperCase();
    result = result + i;
  }
  return result;
}

const init = () => {
  const localVideo = document.getElementById("local-video");
  const remoteVideo = document.getElementById("remote-video");
  const callButton = document.getElementById("call-button");
  const callUuid = document.getElementById("call-uuid");
  const callApt = document.getElementById("call-apt");
  const timer = document.getElementById("timer");
  callButton.addEventListener("click", onCallButton);

  callUuid.value = generateGuid();

  localVideo.addEventListener("loadedmetadata", function () {
    debug(
      `Local video width: ${this.videoWidth}px,  height: ${this.videoHeight}px`
    );
  });

  remoteVideo.addEventListener("loadedmetadata", function () {
    debug(
      `Remote video width: ${this.videoWidth}px,  height: ${this.videoHeight}px`
    );
  });

  var centrifuge = new Centrifuge(
    "ws://pubsub.homeid.gmar.by:9000/connection/websocket"
  );
  centrifuge.setToken(tokens.centrifugo_token);
  centrifuge.connect();

  async function onCallButton() {
    let response = await fetch(
      "http://api.homeid.gmar.by:8888/panels-api/v1/calls",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          Authorization: "Bearer " + tokens.access_token,
        },
        body: JSON.stringify({
          apartment_number: callApt.value,
          uuid: callUuid.value,
        }),
      }
    );
    let result = await response.json();
    debug(result);
    if (response.ok) {
      channel = "calls_" + callUuid.value;

      centrifuge.subscribe(channel, function (msg) {
        if (msg.data.event == "offer") {
          if (msg.data.sdp) {
            debug("received offer:");
            debug(msg.data);
            const sdp = { sdp: msg.data.sdp, type: msg.data.type };
            debug("test");
            debug(sdp);
            pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
              createAnswer();
            });
          }
        }
        if (msg.data.event == "candidate") {
          if (msg.data.candidate) {
            debug("received candidate:");
            debug(msg.data);
            const candidate = {
              candidate: msg.data.candidate,
              sdpMLineIndex: msg.data.sdpMLineIndex,
              sdpMid: msg.data.sdpMid,
            };
            pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        }
        if (msg.data.event == "unmute") {
          var seconds = 0;
          timer.style.display = "block";
          setInterval(function () {
            timer.innerHTML = seconds++;
          }, 1000);
        }
      });
    }
  }

  function createAnswer() {
    pc.createAnswer()
      .then((sdp) => pc.setLocalDescription(sdp))
      .then(() => {
        let sdp = pc.localDescription;
        sdp.sdp = updateCodec(sdp.sdp);
        const data = {
          event: "answer",
          type: sdp.type,
          sdp: sdp.sdp,
        };
        debug(data);
        centrifuge
          .publish(channel, data)
          .then(() => debug("answer successfully published"))
          .catch((err) => warn("publish error", err));
      })
      .catch(error);
  }

  function updateCodec(sdp) {
    return sdp.replace(
      "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 127 124 125",
      "m=video 9 UDP/TLS/RTP/SAVPF 100 101 127 124 125 96 97 98 99"
    );
  }

  // create peer

  const pc = new RTCPeerConnection({
    iceServers: [
      {
        url: "stun:stun.l.google.com:19302",
      },
    ],
  });

  // webrtc peer callbacks

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const data = {
        event: "candidate",
        candidate: e.candidate.candidate,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
        sdpMid: e.candidate.sdpMid,
      };
      debug(data);
      centrifuge
        .publish(channel, data)
        .then(() => debug("candidate successfully published"))
        .catch((err) => warn("publish error", err));
    }
  };
  pc.onaddstream = (e) => {
    debug(e);
    remoteVideo.srcObject = e.stream;
  };

  // capture local media

  function onCapturedLocalStream(stream) {
    localStream = stream;
    // localVideo.srcObject = stream;
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    if (videoTracks.length > 0) {
      debug(`Using video device: ${videoTracks[0].label}`);
    }
    if (audioTracks.length > 0) {
      debug(`Using audio device: ${audioTracks[0].label}`);
    }
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  const constraints = {
    video: {
      width: { exact: 480 },
      height: { exact: 720 },
      frameRate: {
        ideal: 20,
        min: 10,
      },
    },
    audio: true,
  };

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then(onCapturedLocalStream)
    .catch(error);
};
